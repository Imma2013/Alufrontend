const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { connectDB, Post, User } = require('./config/db');
const initCreditGuard = require('./utils/creditGuard');
const { generateContent } = require('./services/conductor');
const { createJob, getJob } = require('./services/videoJobs');
const { processVideoJob } = require('./services/videoStitcher');
const paymentRoutes = require('./routes/paymentRoutes');
const syncRoutes = require('./routes/syncRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const dmRoutes = require('./routes/dmRoutes');
const clerkAuth = require('./middleware/clerkAuth');

const app = express();
const PORT = process.env.PORT || 5000;

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

// MongoDB injection protection - sanitize req.body, req.query, req.params
app.use(mongoSanitize({
  replaceWith: '_', // Replace $ and . with _ instead of removing
  onSanitize: ({ req, key }) => {
    console.warn(`Sanitized suspicious key: ${key} from ${req.ip}`);
  },
}));

// Global rate limiter - 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Stricter rate limiter for uploads - 10 req/min per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many uploads. Please try again later.',
});

// Stricter rate limiter for AI generation - 20 req/hour per IP
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many AI generation requests. Please try again later.',
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
    const shortLimit = user.isPro ? 5 : 1;
    const imageLimit = user.isPro ? 30 : 3;
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

// --- Short Video Stitching (up to 60s, 9:16 vertical) ---
app.post('/generate/short-video', generateLimiter, clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const { prompt, durationSeconds, visibility, displayName, avatarUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const duration = Math.min(Math.max(durationSeconds || 60, 8), 60); // 8s - 60s

    // Check daily shorts limit
    let user = await User.findOne({ userId });
    if (!user) user = await User.create({ userId, displayName, avatarUrl });
    const shortLimit = user.isPro ? 5 : 1;
    let useBonusShort = false;
    if ((user.dailyShorts || 0) >= shortLimit) {
      if ((user.bonusShorts || 0) > 0) {
        useBonusShort = true;
      } else {
        return res.status(429).json({ error: `Daily shorts limit reached (${shortLimit}/day).` });
      }
    }

    // Create job with 9:16 aspect ratio for shorts
    const job = createJob(userId, prompt, duration, visibility || 'everyone', {
      aspectRatio: '9:16',
      videoType: 'short',
      useBonusShort,
      displayName: displayName || '',
      avatarUrl: avatarUrl || '',
    });

    // Start processing in background (fire and forget)
    processVideoJob(job).catch(err => {
      console.error(`Background short video job ${job.jobId} error:`, err);
    });

    res.status(202).json({ jobId: job.jobId, status: 'queued' });
  } catch (error) {
    console.error('Short Video Error:', error);
    res.status(500).json({ error: 'Failed to start short video generation' });
  }
});

app.get('/generate/status/:jobId', clerkAuth, async (req, res) => {
  const job = getJob(req.params.jobId);
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

const startServer = async () => {
  try {
    await connectDB();
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
