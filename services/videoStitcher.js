/**
 * videoStitcher.js — Long video generation via scene splitting + Veo 2 clips + FFmpeg concat
 *
 * Pipeline:
 * 1. Break prompt into scene descriptions using Gemini Flash
 * 2. Generate each scene as an ~8s clip with Veo 2
 * 3. Download clips to temp directory
 * 4. Concatenate with FFmpeg (bundled via ffmpeg-static)
 * 5. Upload final video to Cloudinary
 * 6. Clean up temp files
 */

const { GoogleGenAI } = require('@google/genai');
const { v2: cloudinary } = require('cloudinary');
const ffmpegPath = require('ffmpeg-static');
const { updateJob } = require('./videoJobs');
const { Post, User } = require('../config/db');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// Initialize Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CLIP_DURATION = 8; // seconds per clip
const MAX_PARALLEL_CLIPS = 3; // rate limiting for API
const MAX_POLL_ATTEMPTS = 60; // 5 min per clip

// Sora 2 config from env
const SORA_API_URL = process.env.THIRD_PARTY_API_URL;
const SORA_API_KEY = process.env.THIRD_PARTY_API_KEY;

/**
 * Split a prompt into multiple scene descriptions using Gemini Flash
 */
async function splitIntoScenes(prompt, numScenes) {
    const instruction = `You are a professional video storyboard writer. Break the following video concept into exactly ${numScenes} sequential scenes. Each scene should be a self-contained 8-second clip description that flows naturally into the next.

Return ONLY a valid JSON array of strings. Each string is a scene description suitable for AI video generation. Do not include numbering or prefixes in the descriptions.

Example format: ["A sunrise over mountains with golden light streaming through clouds", "A bird soaring through the sky against the golden backdrop", ...]

Video concept: ${prompt}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash',
            contents: instruction,
        });

        const text = response.text.trim();
        // Extract JSON array from response (handle code blocks)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('Failed to parse scene descriptions from AI response');
        }

        const scenes = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(scenes) || scenes.length === 0) {
            throw new Error('Scene splitting returned empty result');
        }

        return scenes.slice(0, numScenes);
    } catch (error) {
        console.error('Scene splitting failed:', error.message);
        // Fallback: create simple variations
        const fallbackScenes = [];
        for (let i = 0; i < numScenes; i++) {
            fallbackScenes.push(`${prompt} — scene ${i + 1} of ${numScenes}, continuation`);
        }
        return fallbackScenes;
    }
}

/**
 * Generate a single video clip — tries Sora 2 (piapi.ai) first, falls back to Veo 3.1
 */
async function generateClip(scenePrompt, aspectRatio = '16:9') {
    // Try Sora 2 first (storyboard mode via piapi.ai)
    if (SORA_API_URL && SORA_API_KEY) {
        try {
            const soraResult = await generateClipViaSora(scenePrompt, aspectRatio);
            if (soraResult) return soraResult;
        } catch (err) {
            console.warn('Sora 2 clip failed, falling back to Veo 3.1:', err.message);
        }
    }

    // Fallback: Veo 3.1
    return await generateClipViaVeo(scenePrompt, aspectRatio);
}

/**
 * Generate clip via Sora 2 (piapi.ai)
 */
async function generateClipViaSora(scenePrompt, aspectRatio = '16:9') {
    const axios = require('axios');

    // Create task
    const createRes = await axios.post(SORA_API_URL, {
        prompt: scenePrompt,
        duration: CLIP_DURATION,
        aspect_ratio: aspectRatio,
    }, {
        headers: {
            'x-api-key': SORA_API_KEY,
            'Content-Type': 'application/json',
        },
        timeout: 30000,
    });

    const taskId = createRes.data?.data?.task_id || createRes.data?.task_id;
    if (!taskId) {
        throw new Error('Sora 2 returned no task ID');
    }

    // Poll for completion
    const statusUrl = `${SORA_API_URL}/${taskId}`;
    let attempts = 0;

    while (attempts < MAX_POLL_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const statusRes = await axios.get(statusUrl, {
            headers: { 'x-api-key': SORA_API_KEY },
            timeout: 15000,
        });

        const status = statusRes.data?.data?.status || statusRes.data?.status;
        if (status === 'completed' || status === 'success') {
            const videoUrl = statusRes.data?.data?.video_url || statusRes.data?.data?.output?.video_url;
            if (videoUrl) return videoUrl;
            throw new Error('Sora 2 completed but no video URL');
        } else if (status === 'failed' || status === 'error') {
            throw new Error('Sora 2 generation failed');
        }
        attempts++;
    }
    throw new Error('Sora 2 generation timed out');
}

/**
 * Generate clip via Veo 3.1 (Google GenAI)
 */
async function generateClipViaVeo(scenePrompt, aspectRatio = '16:9') {
    const operation = await ai.models.generateVideos({
        model: 'veo-3.1-generate-preview',
        prompt: scenePrompt,
        config: {
            aspectRatio: aspectRatio,
            durationSeconds: CLIP_DURATION,
        },
    });

    // Poll for completion
    let result = operation;
    let attempts = 0;

    while (!result.done && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        result = await ai.operations.get({ operation: result });
        attempts++;
    }

    if (!result.done) {
        throw new Error('Veo 3.1 clip generation timed out');
    }

    if (!result.response?.generatedVideos || result.response.generatedVideos.length === 0) {
        throw new Error('Veo 3.1 clip generation returned no videos');
    }

    const videoData = result.response.generatedVideos[0].video;
    return videoData.uri || null;
}

/**
 * Download a file from URL to local path
 */
function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(filePath);
        protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                downloadFile(response.headers.location, filePath).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(filePath);
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => { });
            reject(err);
        });
    });
}

/**
 * Process clips in batches to respect rate limits
 */
async function generateClipsInBatches(scenes, jobId, job) {
    const clipPaths = [];
    const tmpDir = path.join(os.tmpdir(), `alu-video-${jobId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const total = scenes.length;
    let completed = 0;

    for (let i = 0; i < scenes.length; i += MAX_PARALLEL_CLIPS) {
        const batch = scenes.slice(i, i + MAX_PARALLEL_CLIPS);

        const batchPromises = batch.map(async (scene, batchIdx) => {
            const clipIdx = i + batchIdx;
            const clipPath = path.join(tmpDir, `clip_${String(clipIdx).padStart(3, '0')}.mp4`);

            try {
                const videoUrl = await generateClip(scene, job.aspectRatio || '16:9');
                if (videoUrl) {
                    await downloadFile(videoUrl, clipPath);
                    return clipPath;
                }
                return null;
            } catch (err) {
                console.error(`Clip ${clipIdx} failed:`, err.message);
                return null;
            }
        });

        const results = await Promise.all(batchPromises);

        for (const clipPath of results) {
            if (clipPath) {
                clipPaths.push(clipPath);
            }
            completed++;
            updateJob(jobId, {
                progress: Math.round((completed / total) * 70), // 70% for clip generation
                completedClips: completed,
                currentStep: `Generated clip ${completed}/${total}`,
            });
        }

        // Brief pause between batches to avoid rate limiting
        if (i + MAX_PARALLEL_CLIPS < scenes.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return { clipPaths, tmpDir };
}

/**
 * Concatenate clips using FFmpeg
 */
function concatenateClips(clipPaths, tmpDir, outputPath) {
    // Create concat file
    const concatFilePath = path.join(tmpDir, 'concat.txt');
    const concatContent = clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatFilePath, concatContent);

    // Run FFmpeg (using bundled binary from ffmpeg-static)
    const ffmpegCmd = `"${ffmpegPath}" -y -f concat -safe 0 -i "${concatFilePath}" -c copy -movflags +faststart "${outputPath}"`;

    try {
        execSync(ffmpegCmd, { stdio: 'pipe', timeout: 120000 });
    } catch (error) {
        // If copy mode fails, try re-encoding
        const reencodeCmd = `"${ffmpegPath}" -y -f concat -safe 0 -i "${concatFilePath}" -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart "${outputPath}"`;
        execSync(reencodeCmd, { stdio: 'pipe', timeout: 300000 });
    }

    return outputPath;
}

/**
 * Upload final video to Cloudinary
 */
async function uploadToCloudinary(filePath, userId, folder = 'alu-long-videos') {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(filePath, {
            resource_type: 'video',
            folder: folder,
            public_id: `${userId}_${folder === 'alu-shorts' ? 'short' : 'long'}_${Date.now()}`,
            eager: [
                { format: 'jpg', width: 640, height: 360, crop: 'thumb', gravity: 'auto' },
            ],
            eager_async: false,
            chunk_size: 20 * 1024 * 1024, // 20MB chunks for large files
        }, (error, result) => {
            if (error) reject(error);
            else resolve({
                videoUrl: result.secure_url,
                thumbnailUrl: result.eager?.[0]?.secure_url || null,
                duration: result.duration,
            });
        });
    });
}

/**
 * Clean up temporary files
 */
function cleanup(tmpDir) {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

/**
 * Main stitching pipeline — runs in background
 */
async function processVideoJob(job) {
    const { jobId, userId, prompt, durationSeconds, visibility, videoType, displayName, avatarUrl } = job;
    const isShort = videoType === 'short';
    let tmpDir = null;

    try {
        // 1. Calculate number of clips needed
        const numClips = Math.ceil(durationSeconds / CLIP_DURATION);
        updateJob(jobId, {
            status: 'splitting_scenes',
            totalClips: numClips,
            currentStep: `Breaking your idea into ${numClips} scenes...`,
            progress: 5,
        });

        // 2. Split prompt into scenes
        const scenes = await splitIntoScenes(prompt, numClips);
        updateJob(jobId, {
            status: 'generating_clips',
            currentStep: `Generating ${scenes.length} video clips...`,
            progress: 10,
        });

        // 3. Generate all clips
        const { clipPaths, tmpDir: dir } = await generateClipsInBatches(scenes, jobId, job);
        tmpDir = dir;

        if (clipPaths.length === 0) {
            throw new Error('No clips were successfully generated');
        }

        if (clipPaths.length < Math.floor(numClips * 0.5)) {
            throw new Error(`Only ${clipPaths.length}/${numClips} clips generated. Too many failures.`);
        }

        // 4. Concatenate clips
        updateJob(jobId, {
            status: 'stitching',
            currentStep: 'Stitching clips together...',
            progress: 75,
        });

        const outputPath = path.join(tmpDir, 'final_output.mp4');
        concatenateClips(clipPaths, tmpDir, outputPath);

        // 5. Upload to Cloudinary
        updateJob(jobId, {
            status: 'uploading',
            currentStep: 'Uploading your video...',
            progress: 85,
        });

        const cloudResult = await uploadToCloudinary(outputPath, userId, isShort ? 'alu-shorts' : 'alu-long-videos');

        // 6. Create Post in MongoDB
        const post = await Post.create({
            userId,
            contentUrl: cloudResult.videoUrl,
            safePrompt: prompt,
            originalPrompt: prompt,
            is_ai: true,
            mediaType: 'video',
            videoType: isShort ? 'short' : 'long',
            isLongForm: !isShort,
            thumbnailUrl: cloudResult.thumbnailUrl,
            visibility: visibility || 'everyone',
            displayName: displayName || '',
            avatarUrl: avatarUrl || '',
        });

        // 7. Update user usage
        const user = await User.findOne({ userId });
        if (user) {
            user[isShort ? 'dailyShorts' : 'dailyLongVids'] += 1;
            await user.save();
        }

        // 8. Mark complete
        updateJob(jobId, {
            status: 'complete',
            progress: 100,
            videoUrl: cloudResult.videoUrl,
            thumbnailUrl: cloudResult.thumbnailUrl,
            currentStep: 'Video ready!',
            postId: post._id.toString(),
        });

        console.log(`Long video job ${jobId} complete: ${cloudResult.videoUrl}`);

    } catch (error) {
        console.error(`Long video job ${jobId} failed:`, error.message);
        updateJob(jobId, {
            status: 'failed',
            error: error.message,
            currentStep: 'Generation failed',
        });
    } finally {
        if (tmpDir) cleanup(tmpDir);
    }
}

module.exports = { processVideoJob };

