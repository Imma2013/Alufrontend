const express = require('express');
const clerkAuth = require('../middleware/clerkAuth');
const { DMThread, DMMessage, User } = require('../config/db');

const router = express.Router();

const normalizeParticipant = (a, b) => [a, b].sort();

const toThreadResponse = async (thread, currentUserId) => {
  const participantId = thread.participants.find((id) => id !== currentUserId) || currentUserId;
  const participant = await User.findOne(
    { userId: participantId },
    { userId: 1, displayName: 1, avatarUrl: 1, _id: 0 }
  );

  return {
    _id: thread._id.toString(),
    participantId,
    participantName: participant?.displayName || 'Alu User',
    participantAvatar: participant?.avatarUrl || '',
    lastMessage: thread.lastMessage || '',
    lastMessageAt: thread.lastMessageAt,
    unreadCount: Number(thread.unreadCounts?.get(currentUserId) || 0),
  };
};

// List current user's DM threads
router.get('/threads', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const threads = await DMThread.find({ participants: userId }).sort({ lastMessageAt: -1 }).limit(100);
    const hydrated = await Promise.all(threads.map((thread) => toThreadResponse(thread, userId)));
    res.json({ threads: hydrated });
  } catch (error) {
    console.error('DM threads list error:', error);
    res.status(500).json({ error: 'Failed to list threads' });
  }
});

// Create or fetch 1:1 thread
router.post('/threads', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const participantId = (req.body?.participantId || '').trim();

    if (!participantId) return res.status(400).json({ error: 'participantId is required' });
    if (participantId === userId) return res.status(400).json({ error: 'Cannot create a thread with yourself' });

    const participants = normalizeParticipant(userId, participantId);
    let thread = await DMThread.findOne({
      participants: { $all: participants, $size: 2 },
    });

    if (!thread) {
      thread = await DMThread.create({
        participants,
        createdBy: userId,
        lastMessage: '',
        lastMessageAt: new Date(),
        unreadCounts: {
          [userId]: 0,
          [participantId]: 0,
        },
      });
    }

    const payload = await toThreadResponse(thread, userId);
    res.status(201).json({ thread: payload });
  } catch (error) {
    console.error('DM thread create error:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// List messages in a thread
router.get('/threads/:threadId/messages', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const { threadId } = req.params;
    const thread = await DMThread.findById(threadId);

    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!thread.participants.includes(userId)) return res.status(403).json({ error: 'Forbidden' });

    const messages = await DMMessage.find({ threadId }).sort({ createdAt: 1 }).limit(500);
    res.json({
      messages: messages.map((msg) => ({
        _id: msg._id.toString(),
        threadId: msg.threadId.toString(),
        senderId: msg.senderId,
        text: msg.text || '',
        imageUrl: msg.imageUrl || '',
        status: msg.status || 'sent',
        createdAt: msg.createdAt,
      })),
    });
  } catch (error) {
    console.error('DM messages list error:', error);
    res.status(500).json({ error: 'Failed to list messages' });
  }
});

// Send a message in a thread
router.post('/threads/:threadId/messages', clerkAuth, async (req, res) => {
  try {
    const senderId = req.auth.sub;
    const { threadId } = req.params;
    const text = (req.body?.text || '').trim();
    const imageUrl = (req.body?.imageUrl || '').trim();

    if (!text && !imageUrl) return res.status(400).json({ error: 'Message body is empty' });

    const thread = await DMThread.findById(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!thread.participants.includes(senderId)) return res.status(403).json({ error: 'Forbidden' });

    const message = await DMMessage.create({
      threadId: thread._id,
      senderId,
      text,
      imageUrl,
      status: 'sent',
    });

    const recipientId = thread.participants.find((id) => id !== senderId);
    const unreadForRecipient = Number(thread.unreadCounts?.get(recipientId) || 0) + 1;
    thread.lastMessage = text || 'Photo';
    thread.lastMessageAt = message.createdAt;
    thread.unreadCounts.set(senderId, 0);
    if (recipientId) thread.unreadCounts.set(recipientId, unreadForRecipient);
    await thread.save();

    res.status(201).json({
      message: {
        _id: message._id.toString(),
        threadId: message.threadId.toString(),
        senderId: message.senderId,
        text: message.text || '',
        imageUrl: message.imageUrl || '',
        status: message.status || 'sent',
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    console.error('DM send error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Mark thread as read for current user
router.post('/threads/:threadId/read', clerkAuth, async (req, res) => {
  try {
    const userId = req.auth.sub;
    const { threadId } = req.params;
    const thread = await DMThread.findById(threadId);

    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!thread.participants.includes(userId)) return res.status(403).json({ error: 'Forbidden' });

    thread.unreadCounts.set(userId, 0);
    await thread.save();

    await DMMessage.updateMany(
      { threadId, senderId: { $ne: userId }, status: { $ne: 'seen' } },
      { $set: { status: 'seen' } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('DM read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;
