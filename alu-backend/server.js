const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { connectDB, Post, User } = require('./config/db');
const initCreditGuard = require('./utils/creditGuard');
const { generateContent } = require('./services/conductor');
const { createJob, enqueueJob, getJob, startJobWorker, hasQueueRuntime } = require('./services/videoJobs');
const { processVideoJob } = require('./services/videoStitcher');
const paymentRoutes = require('./routes/paymentRoutes');
const syncRoutes = require('./routes/syncRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const dmRoutes = require('./routes/dmRoutes');
const storyRoutes = require('./routes/storyRoutes');
const clerkAuth = require('./middleware/clerkAuth');

const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);

// Middleware
app.use((req, res, next) => {
  if (req.originalUrl === '/payments/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

const limiterHandler = (friendly) => (req, res) => {
  res.status(429).json({ error: friendly });
};

// Global limiter: high enough for polling/streaming/chat traffic.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.GLOBAL_RATE_LIMIT_MAX || 1000),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler('Too many requests from this IP, please try again later.'),
});

// Upload limiter: still strict
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler('Too many uploads. Please try again later.'),
});

// AI generation limiter (cost guard)
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.GENERATE_RATE_LIMIT_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limiterHandler('Too many AI generation requests from this IP, please try again later.'),
});

// Apply global rate limiter to all routes
app.use(globalLimiter);

// Routes
app.use('/payments', paymentRoutes);
app.use('/sync', syncRoutes);
app.use('/upload', uploadLimiter, uploadRoutes);
app.use('/users', userRoutes);
app.use('/posts', postRoutes);
app.use('/notifications', notificationRoutes);
app.use('/dm', dmRoutes);
app.use('/stories', storyRoutes);

// This route is now protected. A valid Clerk token is required.
app.post('/generate', generateLimiter, clerkAuth, async (req, res) => {
  const userId = req.auth.sub;
  const { prompt, type, isLongVideo, visibility, displayName, avatarUrl } = req.body;

  if (!prompt || !type) {
    return res.status(400).json({ error: 'Missing required fields: prompt or type' });
  }

  try {
    const post = await generateContent(userId, prompt, type, isLongVideo, visibility || 'everyone', displayName || '', avatarUrl || '');
    res.status(201).json({ success: true, post });
  } catch (error) {
    if (error.message.includes('429')) {
      return res.status(429).json({ error: error.message });
    }
    console.error('Server Generation Error:', error);
    res.status(500).json({ error: 'Internal Server Error during generation' });
  }
});

// Usage endpoint — returns real daily counts + bonus credits
app.get('/usage', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    let user = await User.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const lastShortReset = new Date(user.lastShortResetDate || user.lastResetDate || 0).getTime();
    if (now - lastShortReset >= weekMs) {
      user.dailyShorts = 0;
      user.lastShortResetDate = new Date(now);
      await user.save();
    }

    const shortLimit = 1; // one short per week
    const imageLimit = 3; // three images per day
    const bonusImages = user.bonusImages || 0;
    const bonusShorts = user.bonusShorts || 0;
    const remainingImages = Math.max(0, imageLimit - (user.dailyImages || 0)) + bonusImages;
    const remainingShorts = Math.max(0, shortLimit - (user.dailyShorts || 0)) + bonusShorts;
    res.json({
      dailyImages: user.dailyImages || 0,
      dailyShorts: user.dailyShorts || 0,
      bonusImages,
      bonusShorts,
      remainingImages,
      remainingShorts,
      limits: {
        image: imageLimit,
        short: shortLimit,
      },
      isPro: user.isPro || false,
    });
  } catch (error) {
    console.error('Usage Error:', error);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// This route remains public for now
app.get('/feed', async (req, res) => {
  try {
    const { type, media } = req.query;
    let filter = { visibility: 'everyone' };

    if (type === 'ai') filter.is_ai = true;
    if (type === 'human') filter.is_ai = false;

    if (media === 'image') filter.mediaType = 'image';
    if (media === 'video') filter.mediaType = 'video';

    const posts = await Post.find(filter).sort({ timestamp: -1 }).limit(50);

    // Add comment counts to each post
    const { Comment } = require('./config/db');
    const postsWithCounts = await Promise.all(
      posts.map(async (post) => {
        const commentCount = await Comment.countDocuments({ postId: post._id });
        return { ...post.toObject(), commentsCount: commentCount };
      })
    );

    res.json(postsWithCounts);
  } catch (error) {
    console.error('Feed Error:', error);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

app.get('/', (req, res) => {
  res.send('Alu API is running with Conductor & CreditGuard');
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

// --- Short Video Stitching (up to 60s, 9:16 vertical) ---
app.post('/generate/short-video', generateLimiter, clerkAuth, async (req, res) => {
  try {
    const shortsEnabled = String(process.env.SHORTS_GENERATION_ENABLED || 'false').toLowerCase() === 'true';
    if (!shortsEnabled) {
      return res.status(410).json({ error: 'AI short generation is currently disabled. You can still upload short videos.' });
    }

    const userId = req.auth.sub;
    const { prompt, durationSeconds, visibility, displayName, avatarUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const maxShortSeconds = Number(process.env.SHORT_VIDEO_MAX_SECONDS || 32);
    const duration = Math.min(Math.max(durationSeconds || 60, 8), Math.max(8, maxShortSeconds));

    // Check weekly shorts limit
    let user = await User.findOne({ userId });
    if (!user) user = await User.create({ userId, displayName, avatarUrl });
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const lastShortReset = new Date(user.lastShortResetDate || user.lastResetDate || 0).getTime();
    if (now - lastShortReset >= weekMs) {
      user.dailyShorts = 0;
      user.lastShortResetDate = new Date(now);
      await user.save();
    }

    const shortLimit = 1;
    let useBonusShort = false;
    if ((user.dailyShorts || 0) >= shortLimit) {
      if ((user.bonusShorts || 0) > 0) {
        useBonusShort = true;
      } else {
        return res.status(429).json({ error: `Weekly shorts limit reached (${shortLimit}/week).` });
      }
    }

    // Create job with 9:16 aspect ratio for shorts
    const job = await createJob(userId, prompt, duration, visibility || 'everyone', {
      aspectRatio: '9:16',
      videoType: 'short',
      useBonusShort,
      displayName: displayName || '',
      avatarUrl: avatarUrl || '',
    });

    const queued = await enqueueJob(job.jobId);
    if (!queued) {
      // Fallback mode if Redis/BullMQ not configured
      processVideoJob(job).catch(err => {
        console.error(`Background short video job ${job.jobId} error:`, err);
      });
    }

    res.status(202).json({ jobId: job.jobId, status: 'queued' });
  } catch (error) {
    console.error('Short Video Error:', error);
    res.status(500).json({ error: 'Failed to start short video generation' });
  }
});

app.get('/generate/status/:jobId', clerkAuth, async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Security: only the job owner can check status
  if (job.userId !== req.auth.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    totalClips: job.totalClips,
    completedClips: job.completedClips,
    currentStep: job.currentStep,
    videoUrl: job.videoUrl,
    thumbnailUrl: job.thumbnailUrl,
    error: job.error,
    postId: job.postId || null,
  });
});

// Global error handler: always return JSON and never default to HTML error pages.
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const startServer = async () => {
  try {
    await connectDB();
    startJobWorker();
    if (hasQueueRuntime()) {
      console.log('Video queue enabled: BullMQ + Redis');
    }
    initCreditGuard();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
