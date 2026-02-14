const express = require('express');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const clerkAuth = require('../middleware/clerkAuth');
const { Post, User, Notification } = require('../config/db');
const { notifyMentions } = require('../utils/mentions');

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer: store in memory (buffer), 200MB limit (generous since we're just a passthrough)
// Users store files in OPFS locally - we just sync to Cloudinary for sharing
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
const VIDEO_QUALITY_PROFILES = {
  '360p': { height: 360, bitRate: '700k' },
  '720p': { height: 720, bitRate: '2500k' },
  '1080p': { height: 1080, bitRate: '4500k' },
  '4k': { height: 2160, bitRate: '12000k' },
};

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
  const { caption, mediaType, videoType, visibility, displayName, avatarUrl, is_ai, quality } = req.body;
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

    // Upload all files to Cloudinary
    const uploadPromises = files.map((file, index) => {
      return new Promise((resolve, reject) => {
        const resourceType = mediaType === 'image' ? 'image' : 'video';
        const options = {
          resource_type: resourceType,
          folder: 'alu-uploads',
          public_id: `${userId}_${Date.now()}_${index}`,
          context: {
            alt: cleanCaption || 'Alu upload',
            user_id: userId,
            media_type: mediaType,
          },
        };

        // For videos, apply quality and generate thumbnail
        if (resourceType === 'video') {
          const profile = VIDEO_QUALITY_PROFILES[quality] || VIDEO_QUALITY_PROFILES['360p'];

          // Normalize uploads into delivery-safe mp4 and generate poster.
          options.transformation = [
            { fetch_format: 'mp4' },
            { video_codec: 'h264', audio_codec: 'aac' },
          ];
          options.eager = [
            { format: 'jpg', width: 400, height: 400, crop: 'thumb', gravity: 'auto' },
            {
              format: 'mp4',
              quality: 'auto:good',
              crop: 'limit',
              height: profile.height,
              bitrate: profile.bitRate,
              flags: 'streaming_attachment',
            },
            {
              format: 'webm',
              quality: 'auto:good',
              crop: 'limit',
              height: profile.height,
            },
          ];
          options.eager_async = false;
        } else {
          // Normalize image output for fast delivery and consistent quality.
          options.transformation = [{ fetch_format: 'auto', quality: 'auto:good' }];
        }

        const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });

        uploadStream.end(file.buffer);
      });
    });

    const cloudResults = await Promise.all(uploadPromises);
    const imageUrls = cloudResults.map(result => result.secure_url);

    // Create Post in MongoDB
    const post = await Post.create({
      userId,
      contentUrl: imageUrls[0], // First image/video as primary
      images: imageUrls.length > 1 ? imageUrls : undefined, // Store all URLs if multiple
      caption: caption || '',
      safePrompt: cleanCaption || 'User upload',
      originalPrompt: cleanCaption || '',
      is_ai: is_ai === 'true' || is_ai === true,
      mediaType,
      videoType: mediaType === 'video' ? (videoType || 'short') : undefined,
      isLongForm: videoType === 'long',
      thumbnailUrl: cloudResults[0].eager?.[0]?.secure_url || null,
      visibility: visibility || 'everyone',
      displayName: displayName || '',
      avatarUrl: avatarUrl || '',
      uploadMeta: {
        originalCount: files.length,
        firstAsset: {
          bytes: cloudResults[0]?.bytes || 0,
          format: cloudResults[0]?.format || '',
          width: cloudResults[0]?.width || 0,
          height: cloudResults[0]?.height || 0,
          duration: cloudResults[0]?.duration || 0,
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
