const { v4: uuidv4 } = require('uuid');
const { VideoJob } = require('../config/db');

let Queue = null;
let Worker = null;
let IORedis = null;
try {
  ({ Queue, Worker } = require('bullmq'));
  IORedis = require('ioredis');
} catch {
  // BullMQ/Redis optional at runtime; service falls back to DB-only mode.
}

const REDIS_URL = process.env.REDIS_URL || '';
const JOB_QUEUE_NAME = process.env.VIDEO_JOB_QUEUE || 'video-generation';
const WORKER_CONCURRENCY = Number(process.env.VIDEO_WORKER_CONCURRENCY || 2);

let queue = null;
let worker = null;
let redis = null;

function hasQueueRuntime() {
  return Boolean(Queue && Worker && IORedis && REDIS_URL);
}

function createRedisConnection() {
  if (!hasQueueRuntime()) return null;
  if (!redis) {
    redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  }
  return redis;
}

function getQueue() {
  if (!hasQueueRuntime()) return null;
  if (!queue) {
    queue = new Queue(JOB_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 2000 },
        removeOnFail: { age: 24 * 3600, count: 2000 },
      },
    });
  }
  return queue;
}

async function createJob(userId, prompt, durationSeconds, visibility, options = {}) {
  const jobId = uuidv4();
  const now = new Date();
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
    createdAt: now,
    updatedAt: now,
  };

  await VideoJob.findOneAndUpdate({ jobId }, job, { upsert: true, new: true });
  return job;
}

async function enqueueJob(jobId) {
  const q = getQueue();
  if (!q) return false;
  await q.add('process-video-job', { jobId }, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  });
  return true;
}

async function updateJob(jobId, updates) {
  return VideoJob.findOneAndUpdate(
    { jobId },
    { $set: { ...updates, updatedAt: new Date() } },
    { new: true }
  );
}

async function getJob(jobId) {
  return VideoJob.findOne({ jobId }).lean();
}

function startJobWorker() {
  if (!hasQueueRuntime()) {
    console.warn('Video job worker running without BullMQ (REDIS_URL missing). Falling back to in-process execution.');
    return null;
  }
  if (worker) return worker;

  worker = new Worker(
    JOB_QUEUE_NAME,
    async (bullJob) => {
      const { jobId } = bullJob.data || {};
      if (!jobId) throw new Error('Missing jobId in queued job payload');
      const job = await VideoJob.findOne({ jobId }).lean();
      if (!job) throw new Error(`VideoJob not found: ${jobId}`);

      const { processVideoJob } = require('./videoStitcher');
      await processVideoJob(job);
      return true;
    },
    { connection: createRedisConnection(), concurrency: WORKER_CONCURRENCY }
  );

  worker.on('failed', async (bullJob, err) => {
    const jobId = bullJob?.data?.jobId;
    if (!jobId) return;
    await updateJob(jobId, {
      status: 'failed',
      error: err?.message || 'Worker failed',
      currentStep: 'Generation failed',
    });
  });

  return worker;
}

module.exports = { createJob, enqueueJob, updateJob, getJob, startJobWorker, hasQueueRuntime };
