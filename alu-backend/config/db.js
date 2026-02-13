const mongoose = require('mongoose');

// User Schema - Tracks credits + profile info
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  bio: { type: String, default: '' },
  dailyImages: { type: Number, default: 0 },
  dailyShorts: { type: Number, default: 0 },
  dailyLongVids: { type: Number, default: 0 },
  monthlyShorts: { type: Number, default: 0 },
  lastResetDate: { type: Date, default: Date.now },
  lastMonthlyResetDate: { type: Date, default: Date.now },
  isPro: { type: Boolean, default: false },
  subscriptionId: { type: String },
  stripeCustomerId: { type: String },
  bonusImages: { type: Number, default: 0 },
  followers: [{ type: String }],
  following: [{ type: String }],
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
  type: { type: String, enum: ['like', 'comment', 'follow', 'comment_like', 'reply'], required: true },
  fromUserId: { type: String, required: true },
  fromDisplayName: { type: String, default: '' },
  fromAvatarUrl: { type: String, default: '' },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }, // for reply notifications
  commentText: { type: String }, // preview of comment
  read: { type: Boolean, default: false },
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const Notification = mongoose.model('Notification', NotificationSchema);

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

module.exports = { connectDB, User, Post, Comment, Notification };
