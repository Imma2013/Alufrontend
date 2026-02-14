/**
 * videoJobs.js — Simple in-memory job queue for long video generation
 *
 * Status flow: queued → splitting_scenes → generating_clips → stitching → uploading → complete | failed
 */

const { v4: uuidv4 } = require('uuid');

// In-memory job store (replace with Redis for production)
const jobs = new Map();

/**
 * Create a new video generation job
 */
function createJob(userId, prompt, durationSeconds, visibility, options = {}) {
    const jobId = uuidv4();
    const job = {
        jobId,
        userId,
        prompt,
        durationSeconds,
        visibility: visibility || 'everyone',
        aspectRatio: options.aspectRatio || '16:9',
        videoType: options.videoType || 'long',
        useBonusShort: Boolean(options.useBonusShort),
        displayName: options.displayName || '',
        avatarUrl: options.avatarUrl || '',
        status: 'queued',
        progress: 0,
        totalClips: 0,
        completedClips: 0,
        currentStep: 'Waiting in queue...',
        videoUrl: null,
        thumbnailUrl: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    jobs.set(jobId, job);
    return job;
}

/**
 * Update job status
 */
function updateJob(jobId, updates) {
    const job = jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, updates, { updatedAt: new Date() });
    return job;
}

/**
 * Get job status
 */
function getJob(jobId) {
    return jobs.get(jobId) || null;
}

/**
 * Clean up old completed/failed jobs (older than 1 hour)
 */
function cleanupOldJobs() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of jobs) {
        if (['complete', 'failed'].includes(job.status) && job.updatedAt.getTime() < oneHourAgo) {
            jobs.delete(id);
        }
    }
}

// Clean up every 10 minutes
setInterval(cleanupOldJobs, 10 * 60 * 1000);

module.exports = { createJob, updateJob, getJob };
