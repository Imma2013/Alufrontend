const express = require('express');
const clerkAuth = require('../middleware/clerkAuth');
const { Story, User, DMThread, DMMessage } = require('../config/db');

const router = express.Router();

const toStoryResponse = (story) => ({
  _id: String(story._id),
  userId: story.userId,
  imageUrl: story.imageUrl,
  text: story.text || '',
  textColor: story.textColor || '#ffffff',
  textSize: story.textSize || 42,
  createdAt: story.createdAt,
  expiresAt: story.expiresAt,
  displayName: story.displayName || '',
  avatarUrl: story.avatarUrl || '',
  viewedBy: story.viewedBy || [],
  likedBy: story.likedBy || [],
});

async function cleanupExpiredStories() {
  await Story.deleteMany({ expiresAt: { $lte: new Date() } });
}

router.get('/', async (req, res) => {
  try {
    await cleanupExpiredStories();
    const stories = await Story.find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 }).limit(500);
    res.json({ stories: stories.map(toStoryResponse) });
  } catch (error) {
    console.error('Stories feed error:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

router.post('/', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const imageUrl = (req.body?.imageUrl || '').trim();
    const text = (req.body?.text || '').trim().slice(0, 300);
    const textColor = (req.body?.textColor || '#ffffff').trim();
    const textSize = Number(req.body?.textSize || 42);
    const displayName = (req.body?.displayName || '').trim();
    const avatarUrl = (req.body?.avatarUrl || '').trim();

    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await Story.deleteMany({ userId, expiresAt: { $gt: now } });

    await User.findOneAndUpdate(
      { userId },
      { $set: { displayName: displayName || '', avatarUrl: avatarUrl || '' } },
      { upsert: true }
    );

    const story = await Story.create({
      userId,
      imageUrl,
      text,
      textColor,
      textSize,
      displayName,
      avatarUrl,
      viewedBy: [userId],
      likedBy: [],
      expiresAt,
    });

    res.status(201).json({ story: toStoryResponse(story) });
  } catch (error) {
    console.error('Story create error:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

router.post('/:storyId/view', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const { storyId } = req.params;
    const story = await Story.findById(storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (!story.viewedBy.includes(userId)) {
      story.viewedBy.push(userId);
      await story.save();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Story view error:', error);
    res.status(500).json({ error: 'Failed to mark story as viewed' });
  }
});

router.post('/:storyId/like', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const { storyId } = req.params;
    const story = await Story.findById(storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const liked = story.likedBy.includes(userId);
    if (liked) story.likedBy = story.likedBy.filter((id) => id !== userId);
    else story.likedBy.push(userId);
    await story.save();

    res.json({ liked: !liked, likedBy: story.likedBy });
  } catch (error) {
    console.error('Story like error:', error);
    res.status(500).json({ error: 'Failed to like story' });
  }
});

router.post('/:storyId/reply', clerkAuth, async (req, res) => {
  try {
    const senderId = req.auth.sub;
    const { storyId } = req.params;
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Reply text is required' });

    const story = await Story.findById(storyId);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (story.userId === senderId) return res.status(400).json({ error: 'Cannot reply to your own story' });

    const participants = [senderId, story.userId].sort();
    let thread = await DMThread.findOne({ participants: { $all: participants, $size: 2 } });

    if (!thread) {
      thread = await DMThread.create({
        participants,
        createdBy: senderId,
        lastMessage: '',
        lastMessageAt: new Date(),
        unreadCounts: { [senderId]: 0, [story.userId]: 0 },
      });
    }

    const message = await DMMessage.create({
      threadId: thread._id,
      senderId,
      text,
      imageUrl: '',
      status: 'sent',
    });

    thread.lastMessage = text;
    thread.lastMessageAt = message.createdAt;
    thread.unreadCounts.set(senderId, 0);
    thread.unreadCounts.set(story.userId, Number(thread.unreadCounts.get(story.userId) || 0) + 1);
    await thread.save();

    res.status(201).json({ success: true, threadId: String(thread._id) });
  } catch (error) {
    console.error('Story reply error:', error);
    res.status(500).json({ error: 'Failed to send story reply' });
  }
});

module.exports = router;
