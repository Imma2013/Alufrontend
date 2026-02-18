const express = require('express');
const multer = require('multer');
const clerkAuth = require('../middleware/clerkAuth');
const { Post, User, Notification } = require('../config/db');
const { notifyMentions } = require('../utils/mentions');
const {
  extFromMime,
  buildKey,
  uploadBuffer,
  uploadVideoBufferWithThumbnail,
} = require('../services/storj');

const router = express.Router();

// Multer: store in memory (buffer), 200MB limit (generous since we're just a passthrough)
// Users store files in OPFS locally - backend syncs copies to Storj for sharing.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB - local-first means user's device handles the size
  fileFilter: (req, file, cb) => {
    // Only allow images and videos
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only images and videos allowed.`));
    }
  },
});

const MAX_CAPTION_LENGTH = 2200;
const sanitizeText = (value = '') => String(value).replace(/\s+/g, ' ').trim();

/**
 * POST /upload
 * Accepts multipart/form-data with:
 *   - file or files: single file or multiple image files (up to 3 for carousel)
 *   - mediaType: 'image' | 'video'
 *   - caption: optional text caption
 *   - videoType: 'short' | 'long' (optional, for videos)
 */
router.post(
  '/',
  clerkAuth,
  upload.fields([
    { name: 'files', maxCount: 3 },
    { name: 'file', maxCount: 1 },
  ]),
  async (req, res) => {
  const userId = req.auth.sub;
  const { caption, mediaType, videoType, visibility, displayName, avatarUrl, is_ai } = req.body;
  const cleanCaption = sanitizeText(caption || '');

  // Support both single 'file' and multiple 'files'
  const uploadFiles = req.files || {};
  const files = [...(uploadFiles.files || []), ...(uploadFiles.file || [])];

  if (files.length === 0) {
    return res.status(400).json({ error: 'No file(s) uploaded' });
  }

  if (!mediaType || !['image', 'video'].includes(mediaType)) {
    return res.status(400).json({ error: 'mediaType must be "image" or "video"' });
  }
  if (cleanCaption.length > MAX_CAPTION_LENGTH) {
    return res.status(400).json({ error: `Caption too long. Max ${MAX_CAPTION_LENGTH} characters.` });
  }

  // Limit multi-image uploads to 3 images max
  if (files.length > 3 && mediaType === 'image') {
    return res.status(400).json({ error: 'Maximum 3 images allowed per post' });
  }

  // Videos must be a single file per post
  if (mediaType === 'video' && files.length > 1) {
    return res.status(400).json({ error: 'Video posts can only contain one file' });
  }

  try {
    // Sync user profile info to User record (makes them searchable)
    if (displayName) {
      await User.findOneAndUpdate(
        { userId },
        { $set: { displayName, avatarUrl: avatarUrl || '' } },
        { upsert: true }
      );
    }

    const uploaded = await Promise.all(
      files.map(async (file, index) => {
        if (mediaType === 'video') {
          const result = await uploadVideoBufferWithThumbnail(file.buffer, {
            folder: 'alu-uploads',
            userId,
            prefix: `video-${index}`,
            mimeType: file.mimetype || 'video/mp4',
          });
          return {
            url: result.videoUrl,
            thumbnailUrl: result.thumbnailUrl || null,
            bytes: file.size || file.buffer.length || 0,
            format: extFromMime(file.mimetype || '', 'mp4'),
            width: 0,
            height: 0,
            duration: 0,
          };
        }

        const ext = extFromMime(file.mimetype || '', 'jpg');
        const key = buildKey({
          folder: 'alu-uploads',
          userId,
          prefix: `image-${index}`,
          ext,
        });
        const url = await uploadBuffer({
          buffer: file.buffer,
          contentType: file.mimetype || 'image/jpeg',
          key,
        });
        return {
          url,
          thumbnailUrl: null,
          bytes: file.size || file.buffer.length || 0,
          format: ext,
          width: 0,
          height: 0,
          duration: 0,
        };
      })
    );

    const mediaUrls = uploaded.map((u) => u.url);
    const primary = uploaded[0];

    // Create Post in MongoDB
    const post = await Post.create({
      userId,
      contentUrl: mediaUrls[0], // First image/video as primary
      images: mediaType === 'image' && mediaUrls.length > 1 ? mediaUrls : undefined,
      caption: caption || '',
      safePrompt: cleanCaption || 'User upload',
      originalPrompt: cleanCaption || '',
      is_ai: is_ai === 'true' || is_ai === true,
      mediaType,
      videoType: mediaType === 'video' ? (videoType || 'short') : undefined,
      isLongForm: videoType === 'long',
      thumbnailUrl: mediaType === 'video' ? (primary.thumbnailUrl || null) : null,
      visibility: visibility || 'everyone',
      displayName: displayName || '',
      avatarUrl: avatarUrl || '',
      uploadMeta: {
        originalCount: files.length,
        firstAsset: {
          bytes: primary?.bytes || 0,
          format: primary?.format || '',
          width: primary?.width || 0,
          height: primary?.height || 0,
          duration: primary?.duration || 0,
        },
      },
    });

    // Notify followers when a new video is posted
    if (mediaType === 'video' && visibility !== 'private') {
      const creator = await User.findOne({ userId });
      const followers = (creator?.followers || []).filter((followerId) => followerId !== userId);
      if (followers.length > 0) {
        await Notification.insertMany(
          followers.map((followerId) => ({
            userId: followerId,
            type: 'new_post',
            fromUserId: userId,
            fromDisplayName: displayName || creator?.displayName || '',
            fromAvatarUrl: avatarUrl || creator?.avatarUrl || '',
            postId: post._id,
          })),
          { ordered: false }
        );
      }
    }

    // Basic @mention notifications for captions
    if (cleanCaption) {
      await notifyMentions({
        text: cleanCaption,
        authorUserId: userId,
        authorDisplayName: displayName || '',
        authorAvatarUrl: avatarUrl || '',
        postId: post._id,
      });
    }

    res.status(201).json({ success: true, post });
  } catch (error) {
    console.error('Upload Error:', error);
    if (error.message?.includes('File too large')) {
      return res.status(413).json({ error: 'File too large. Maximum size is 200MB.' });
    }
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

module.exports = router;
