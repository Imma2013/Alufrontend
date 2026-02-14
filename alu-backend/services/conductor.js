const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const { PostHog } = require('posthog-node');
const { v2: cloudinary } = require('cloudinary');
const { User, Post } = require('../config/db');

// Initialize PostHog
const posthog = new PostHog(process.env.POSTHOG_API_KEY, {
  host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
});

// Initialize Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configure Cloudinary (shared with uploadRoutes)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Limits
const LIMITS = {
  imageFreeDaily: 3,
  imageProDaily: 30,
  shortFreeDaily: 1,
  shortProDaily: 5,
  long: 0, // killed
};

/**
 * Clean the prompt using Gemini 2.0 Flash to remove brands/celebrities.
 */
async function cleanPrompt(prompt) {
  try {
    const instruction = "Rewrite the following prompt to be safe for AI generation. Remove any celebrity names, specific brand names, or copyrighted characters. Replace them with generic descriptions. Keep the artistic style and core intent. Return ONLY the cleaned prompt text.";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash",
      contents: `${instruction}\n\nPrompt: ${prompt}`
    });

    return response.text.trim();
  } catch (error) {
    console.error("Prompt cleaning failed, using original:", error.message);
    return prompt;
  }
}

/**
 * Upload a base64 image buffer to Cloudinary and return the URL
 */
async function uploadBase64ToCloudinary(base64Data, userId) {
  return new Promise((resolve, reject) => {
    const dataUri = `data:image/png;base64,${base64Data}`;
    cloudinary.uploader.upload(dataUri, {
      resource_type: 'image',
      folder: 'alu-ai-gen',
      public_id: `${userId}_${Date.now()}`,
    }, (error, result) => {
      if (error) reject(error);
      else resolve(result.secure_url);
    });
  });
}

/**
 * Upload a video buffer/URL to Cloudinary and return the URL
 */
async function uploadVideoToCloudinary(videoUrl, userId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(videoUrl, {
      resource_type: 'video',
      folder: 'alu-ai-gen',
      public_id: `${userId}_${Date.now()}`,
      eager: [
        { format: 'jpg', width: 400, height: 400, crop: 'thumb', gravity: 'auto' },
      ],
      eager_async: false,
    }, (error, result) => {
      if (error) reject(error);
      else resolve({
        videoUrl: result.secure_url,
        thumbnailUrl: result.eager?.[0]?.secure_url || null,
      });
    });
  });
}

/**
 * Main Conductor Function
 */
async function generateContent(userId, prompt, type, isLongVideo = false, visibility = 'everyone', displayName = '', avatarUrl = '') {
  let user = await User.findOne({ userId });
  if (!user) {
    user = await User.create({ userId, displayName, avatarUrl });
  } else if (displayName && displayName !== user.displayName) {
    // Sync profile info to User record so they're searchable
    user.displayName = displayName;
    if (avatarUrl) user.avatarUrl = avatarUrl;
    await user.save();
  }

  // Limit checking
  if (type === 'image') {
    // Images: daily, Free gets 3, Pro gets 30, bonus credits stack
    const baseLimit = user.isPro ? LIMITS.imageProDaily : LIMITS.imageFreeDaily;
    const bonus = user.bonusImages || 0;
    if (user.dailyImages >= baseLimit + bonus) {
      throw new Error('429: Daily image limit reached.');
    }
  } else if (type === 'video' && !isLongVideo) {
    // Shorts: daily, Free gets 1/day, Pro gets 5/day
    const shortLimit = user.isPro ? LIMITS.shortProDaily : LIMITS.shortFreeDaily;
    if ((user.dailyShorts || 0) >= shortLimit) {
      throw new Error(`429: Daily shorts limit reached (${shortLimit}/day).`);
    }
  } else if (type === 'video' && isLongVideo) {
    // Long videos: killed
    throw new Error('410: Long video generation is temporarily disabled.');
  }

  const safePrompt = await cleanPrompt(prompt);
  console.log(`Cleaned Prompt: "${safePrompt}"`);

  let contentUrl;
  let thumbnailUrl = null;
  let modelName;
  let provider;

  try {
    if (type === 'image') {
      // --- IMAGE: Gemini image models (fallback chain) ---
      const imageModels = [
        { id: 'gemini-3-flash', name: 'NanoBanana Flash' },
        { id: 'gemini-3-flash', name: 'Gemini Flash 2.0' },
      ];

      let imageError = null;
      for (const imageModel of imageModels) {
        try {
          modelName = imageModel.id;
          provider = imageModel.name;
          console.log(`Dispatching to ${provider} (${modelName})...`);

          const imageResponse = await ai.models.generateContent({
            model: modelName,
            contents: safePrompt,
            config: {
              responseModalities: ['IMAGE'],
            },
          });

          const parts = imageResponse.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
          if (!imagePart) throw new Error(`${imageModel.name} returned no image data.`);

          const base64Image = imagePart.inlineData.data;
          contentUrl = await uploadBase64ToCloudinary(base64Image, userId);
          console.log(`Image uploaded to Cloudinary: ${contentUrl}`);
          imageError = null;
          break;
        } catch (err) {
          console.error(`${imageModel.name} failed:`, err.message);
          imageError = err;
        }
      }

      if (imageError) {
        throw new Error(`All image models failed. Last error: ${imageError.message}`);
      }

    } else if (type === 'video' && !isLongVideo) {
      // --- SHORT VIDEO: Try Veo 3.1, fallback to Veo 2.0 ---
      const veoModels = [
        { model: 'veo-3.1-generate-preview', name: 'Google Veo 3.1' },
        { model: 'veo-2.0-generate-001', name: 'Google Veo 2.0' },
      ];

      let videoGenError = null;

      for (const veo of veoModels) {
        modelName = veo.model;
        provider = veo.name;
        console.log(`Dispatching to ${provider} (${modelName})...`);

        try {
          const operation = await ai.models.generateVideos({
            model: modelName,
            prompt: safePrompt,
            config: {
              aspectRatio: "9:16",
              durationSeconds: 8,
            }
          });

          // Poll for completion
          let result = operation;
          let attempts = 0;
          const maxAttempts = 60; // 5 minutes max (5s intervals)

          while (!result.done && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            result = await ai.operations.get({ operation: result });
            attempts++;
            console.log(`Video gen poll attempt ${attempts}/${maxAttempts} (${veo.name})...`);
          }

          if (!result.done) {
            throw new Error(`Video generation timed out after 5 minutes with ${veo.name}.`);
          }

          if (!result.response?.generatedVideos || result.response.generatedVideos.length === 0) {
            throw new Error(`${veo.name} returned no videos.`);
          }

          const videoData = result.response.generatedVideos[0].video;

          // Upload video to Cloudinary
          let videoSource;
          if (videoData.uri) {
            videoSource = videoData.uri;
          } else if (videoData.videoBytes) {
            videoSource = `data:video/mp4;base64,${videoData.videoBytes}`;
          } else {
            throw new Error(`${veo.name} returned no usable video data.`);
          }

          const cloudResult = await uploadVideoToCloudinary(videoSource, userId);
          contentUrl = cloudResult.videoUrl;
          thumbnailUrl = cloudResult.thumbnailUrl;
          console.log(`Video uploaded to Cloudinary via ${veo.name}: ${contentUrl}`);

          videoGenError = null; // Success — clear any previous error
          break; // Exit the fallback loop on success

        } catch (veoErr) {
          console.error(`${veo.name} failed:`, veoErr.message);
          videoGenError = veoErr;
          // Continue to next model in fallback chain
        }
      }

      if (videoGenError) {
        throw new Error(`All video models failed. Last error: ${videoGenError.message}`);
      }

    } else if (type === 'video' && isLongVideo) {
      // --- LONG VIDEO: Not available via simple generation ---
      // Long videos use the stitching pipeline (Phase 3)
      throw new Error('Long video generation uses the video stitching pipeline. Use POST /generate/long-video instead.');
    }

    // Increment usage counter
    if (type === 'image') {
      user.dailyImages += 1;
    } else if (type === 'video' && !isLongVideo) {
      user.dailyShorts = (user.dailyShorts || 0) + 1;
    }
    await user.save();

    const newPost = await Post.create({
      userId, contentUrl, safePrompt, originalPrompt: prompt,
      is_ai: true, mediaType: type,
      videoType: type === 'video' ? (isLongVideo ? 'long' : 'short') : undefined,
      isLongForm: isLongVideo,
      visibility: visibility || 'everyone',
      thumbnailUrl,
      displayName: displayName || '',
      avatarUrl: avatarUrl || '',
    });

    posthog.capture({
      distinctId: userId,
      event: 'ai_content_generated',
      properties: { type, model: modelName, provider, isLongForm: isLongVideo }
    });

    return newPost;

  } catch (error) {
    console.error(`Generation Error (${type}):`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = { generateContent, cleanPrompt };

