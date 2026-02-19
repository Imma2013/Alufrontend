const mongoose = require('mongoose');

// User Schema - Tracks credits + profile info
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  aliases: [{ type: String }],
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  manualAvatarUrl: { type: String, default: '' },
  blueskyAvatarUrl: { type: String, default: '' },
  avatarPreference: { type: String, enum: ['manual', 'bluesky'], default: 'manual' },
  bio: { type: String, default: '' },
  dailyImages: { type: Number, default: 0 },
  dailyShorts: { type: Number, default: 0 },
  dailyLongVids: { type: Number, default: 0 },
  monthlyShorts: { type: Number, default: 0 },
  lastResetDate: { type: Date, default: Date.now },
  lastShortResetDate: { type: Date, default: Date.now },
  lastMonthlyResetDate: { type: Date, default: Date.now },
  isPro: { type: Boolean, default: false },
  subscriptionId: { type: String },
  stripeCustomerId: { type: String },
  bonusImages: { type: Number, default: 0 },
  bonusShorts: { type: Number, default: 0 },
  followers: [{ type: String }],
  following: [{ type: String }],
  atBridgeLastSyncedAt: { type: Date, default: null },
  atBridgeLastStats: { type: mongoose.Schema.Types.Mixed, default: null },
});

// Post Schema - Tracks content
const PostSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  contentUrl: { type: String, required: true },
  safePrompt: { type: String, default: '' },
  originalPrompt: { type: String },
  caption: { type: String, default: '' },
  is_ai: { type: Boolean, default: true },
  mediaType: { type: String, enum: ['image', 'video'], required: true },
  videoType: { type: String, enum: ['short', 'long'] },
  timestamp: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }], // array of userIds who liked
  savedBy: [{ type: String }], // array of userIds who favorited (private)
  isLongForm: { type: Boolean, default: false },
  thumbnailUrl: { type: String },
  visibility: { type: String, enum: ['everyone', 'followers', 'private'], default: 'everyone' },
  status: { type: String, enum: ['ready', 'pending', 'failed'], default: 'ready' },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  images: [{ type: String }], // Array of image URLs for carousel posts (up to 3 images)
  uploadMeta: {
    originalCount: { type: Number, default: 1 },
    firstAsset: {
      bytes: { type: Number, default: 0 },
      format: { type: String, default: '' },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
    },
  },
  source: { type: String, default: '' },
  sourceUri: { type: String, default: '' },
  sourceCid: { type: String, default: '' },
}, { timestamps: true });

// Comment Schema
const CommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  userId: { type: String, required: true },
  text: { type: String, required: true, maxlength: 500 },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }],
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
  imageUrl: { type: String, default: '' },
}, { timestamps: true });

// Notification Schema
const NotificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // who receives this
  type: { type: String, enum: ['like', 'comment', 'follow', 'comment_like', 'reply', 'new_post', 'mention'], required: true },
  fromUserId: { type: String, required: true },
  fromDisplayName: { type: String, default: '' },
  fromAvatarUrl: { type: String, default: '' },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }, // for reply notifications
  commentText: { type: String }, // preview of comment
  read: { type: Boolean, default: false },
}, { timestamps: true });

// DM Thread Schema
const DMThreadSchema = new mongoose.Schema({
  participants: [{ type: String, required: true, index: true }],
  createdBy: { type: String, required: true },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  unreadCounts: { type: Map, of: Number, default: {} }, // keyed by userId
}, { timestamps: true });

// DM Message Schema
const DMMessageSchema = new mongoose.Schema({
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'DMThread', required: true, index: true },
  senderId: { type: String, required: true, index: true },
  text: { type: String, default: '', maxlength: 2000 },
  imageUrl: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'seen'], default: 'sent' },
}, { timestamps: true });

// Persistent video job state (survives restarts, supports queue workers)
const VideoJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  prompt: { type: String, default: '' },
  durationSeconds: { type: Number, default: 60 },
  visibility: { type: String, enum: ['everyone', 'followers', 'private'], default: 'everyone' },
  aspectRatio: { type: String, default: '9:16' },
  videoType: { type: String, enum: ['short', 'long'], default: 'short' },
  useBonusShort: { type: Boolean, default: false },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  status: { type: String, default: 'queued', index: true },
  progress: { type: Number, default: 0 },
  totalClips: { type: Number, default: 0 },
  completedClips: { type: Number, default: 0 },
  currentStep: { type: String, default: 'Waiting in queue...' },
  videoUrl: { type: String, default: null },
  thumbnailUrl: { type: String, default: null },
  error: { type: String, default: null },
  postId: { type: String, default: null },
}, { timestamps: true });

// Story schema (24h lifecycle)
const StorySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  imageUrl: { type: String, required: true },
  text: { type: String, default: '', maxlength: 300 },
  textColor: { type: String, default: '#ffffff' },
  textSize: { type: Number, default: 42 },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  viewedBy: [{ type: String }],
  likedBy: [{ type: String }],
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const DMThread = mongoose.model('DMThread', DMThreadSchema);
const DMMessage = mongoose.model('DMMessage', DMMessageSchema);
const VideoJob = mongoose.model('VideoJob', VideoJobSchema);
const Story = mongoose.model('Story', StorySchema);

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected (Alu Database)');

    // Drop stale email_1 unique index if it exists (causes E11000 duplicate key errors)
    // The current UserSchema has no email field — this index is from an older version
    try {
      const usersCollection = mongoose.connection.collection('users');
      const indexes = await usersCollection.indexes();
      const hasEmailIndex = indexes.some(idx => idx.name === 'email_1');
      if (hasEmailIndex) {
        await usersCollection.dropIndex('email_1');
        console.log('🗑️  Dropped stale email_1 index from users collection');
      }
    } catch (indexErr) {
      // Ignore — index might not exist or collection might not exist yet
      console.warn('Index cleanup skipped:', indexErr.message);
    }
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

module.exports = { connectDB, User, Post, Comment, Notification, DMThread, DMMessage, VideoJob, Story };
