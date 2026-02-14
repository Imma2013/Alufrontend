const { User, Notification } = require('../config/db');

const MENTION_REGEX = /(^|\s)@([a-zA-Z0-9._]{2,30})/g;

function extractMentions(text = '') {
  const value = String(text || '');
  const handles = new Set();
  let match;
  while ((match = MENTION_REGEX.exec(value)) !== null) {
    const handle = (match[2] || '').toLowerCase();
    if (handle) handles.add(handle);
  }
  return [...handles];
}

function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveUsersByHandles(handles = []) {
  const resolved = [];
  for (const handle of handles) {
    const user = await User.findOne(
      { displayName: { $regex: `^${escapeRegex(handle)}$`, $options: 'i' } },
      { userId: 1, displayName: 1, avatarUrl: 1, _id: 0 }
    );
    if (user) resolved.push(user);
  }
  return resolved;
}

async function notifyMentions({
  text = '',
  authorUserId,
  authorDisplayName = '',
  authorAvatarUrl = '',
  postId = null,
  commentId = null,
}) {
  const handles = extractMentions(text);
  if (handles.length === 0) return 0;

  const users = await resolveUsersByHandles(handles);
  if (users.length === 0) return 0;

  const notifications = users
    .filter((u) => u.userId && u.userId !== authorUserId)
    .map((u) => ({
      userId: u.userId,
      type: 'mention',
      fromUserId: authorUserId,
      fromDisplayName: authorDisplayName || '',
      fromAvatarUrl: authorAvatarUrl || '',
      postId: postId || undefined,
      commentId: commentId || undefined,
      commentText: String(text || '').slice(0, 120),
    }));

  if (notifications.length === 0) return 0;
  await Notification.insertMany(notifications, { ordered: false });
  return notifications.length;
}

module.exports = { extractMentions, notifyMentions };
