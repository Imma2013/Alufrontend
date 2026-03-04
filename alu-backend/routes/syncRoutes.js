const express = require('express');
const router = express.Router();
const { Post, Comment } = require('../config/db');
const clerkAuth = require('../middleware/clerkAuth');

// POST /sync/pull
// Retrieve posts updated since a specific time
// Public access for the feed
router.post('/pull', async (req, res) => {
  const { lastSyncTime } = req.body;

  try {
    let query = {
      $or: [
        { visibility: 'everyone' },
        { visibility: { $exists: false } },
      ],
    };
    if (lastSyncTime) {
      query.updatedAt = { $gt: new Date(lastSyncTime) };
    }

    const posts = await Post.find(query).sort({ updatedAt: 1 }).limit(100);

    // Add comment counts to each post
    const changesWithCounts = await Promise.all(
      posts.map(async (post) => {
        const commentCount = await Comment.countDocuments({ postId: post._id });
        return { ...post.toObject(), commentsCount: commentCount };
      })
    );

    res.json({
      changes: changesWithCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sync Pull Error:', error);
    res.status(500).json({ error: 'Failed to pull changes' });
  }
});

// POST /sync/push
// Upload local posts that haven't been saved to cloud yet
// Protected route
router.post('/push', clerkAuth, async (req, res) => {
  const { changes } = req.body; // Array of posts
  const userId = req.auth.sub;

  if (!Array.isArray(changes) || changes.length === 0) {
    return res.json({ success: true, processed: 0 });
  }

  try {
    let processed = 0;
    for (const postData of changes) {
      // Security check: ensure user is syncing their own data
      if (postData.userId !== userId) continue;

      // Upsert: Update if exists, Insert if new
      // We use the Dexie 'id' (if it matches _id) or create new
      const { _id, ...updateData } = postData;

      if (_id && _id.length === 24) { // Valid ObjectId length
        await Post.findByIdAndUpdate(_id, updateData, { upsert: true, new: true });
      } else {
        // It's a purely local post, create it (Mongo will generate _id)
        // Note: In a real offline-first app, we'd use UUIDs to avoid this mapping issue.
        // For now, we assume these are valid posts.
        await Post.create(updateData);
      }
      processed++;
    }

    res.json({ success: true, processed });
  } catch (error) {
    console.error('Sync Push Error:', error);
    res.status(500).json({ error: 'Failed to push changes' });
  }
});

module.exports = router;
