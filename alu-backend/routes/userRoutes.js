const express = require('express');
const multer = require('multer');
const clerkAuth = require('../middleware/clerkAuth');
const { User, Post, Comment, Notification } = require('../config/db');
const { extFromMime, buildKey, uploadBuffer } = require('../services/storj');

const router = express.Router();
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error('Invalid avatar type'), ok);
    },
});

const getLatestPostIdentity = async (userId) => {
    const latest = await Post.findOne(
        {
            userId,
            $or: [
                { displayName: { $exists: true, $ne: '' } },
                { avatarUrl: { $exists: true, $ne: '' } },
            ],
        },
        { displayName: 1, avatarUrl: 1, _id: 0 }
    ).sort({ createdAt: -1 });

    return {
        displayName: latest?.displayName || '',
        avatarUrl: latest?.avatarUrl || '',
    };
};

const toAliasCandidates = (claims) => {
    const aliases = new Set();
    const add = (value) => {
        const v = String(value || '').trim();
        if (v) aliases.add(v);
    };
    add(claims?.sub);
    add(claims?.username);
    add(claims?.preferred_username);
    add(claims?.userId);
    add(claims?.user_id);
    return Array.from(aliases);
};

/**
 * GET /users/search?q=name
 * Search users by displayName (case-insensitive regex)
 */
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 1) {
            return res.json({ users: [] });
        }

        // Escape regex special chars for safety
        const trimmed = q.trim();
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');

        const users = await User.find(
            {
                $or: [
                    { displayName: { $regex: escaped, $options: 'i' } },
                    { userId: { $regex: escaped, $options: 'i' } },
                ],
            },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 }
        ).limit(20);

        // Fallback: include creators that only exist in posts (not yet in users collection)
        // and also match by userId handle. This improves DM search reliability.
        const postAuthors = await Post.aggregate([
            {
                $match: {
                    $or: [
                        { displayName: pattern },
                        { userId: pattern },
                    ],
                },
            },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$userId',
                    displayName: { $first: '$displayName' },
                    avatarUrl: { $first: '$avatarUrl' },
                },
            },
            { $limit: 40 },
        ]);

        const merged = new Map();
        for (const u of users) {
            merged.set(u.userId, {
                userId: u.userId,
                displayName: u.displayName || '',
                avatarUrl: u.avatarUrl || '',
                bio: u.bio || '',
            });
        }

        for (const a of postAuthors) {
            const userId = String(a._id || '');
            if (!userId) continue;
            if (merged.has(userId)) {
                const existing = merged.get(userId);
                merged.set(userId, {
                    ...existing,
                    displayName: existing.displayName || a.displayName || userId,
                    avatarUrl: existing.avatarUrl || a.avatarUrl || '',
                });
                continue;
            }

            merged.set(userId, {
                userId,
                displayName: a.displayName || userId,
                avatarUrl: a.avatarUrl || '',
                bio: '',
            });
        }

        const sorted = Array.from(merged.values())
            .sort((a, b) => {
                const aName = (a.displayName || '').toLowerCase();
                const bName = (b.displayName || '').toLowerCase();
                const query = trimmed.toLowerCase();
                const aExact = aName === query || a.userId.toLowerCase() === query;
                const bExact = bName === query || b.userId.toLowerCase() === query;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                const aStarts = aName.startsWith(query) || a.userId.toLowerCase().startsWith(query);
                const bStarts = bName.startsWith(query) || b.userId.toLowerCase().startsWith(query);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return aName.localeCompare(bName);
            })
            .slice(0, 20);

        res.json({ users: sorted });
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * POST /users/me/sync
 * Ensure signed-in user exists in backend directory so search/DM always works.
 */
router.post('/me/sync', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        if (!userId) return res.status(400).json({ error: 'Invalid auth user' });
        const aliases = toAliasCandidates(req.auth);

        let user = await User.findOne(
            { userId },
            { userId: 1, aliases: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 }
        );

        if (!user) {
            user = await User.create({ userId, aliases: aliases.length ? aliases : [userId] });
        } else if (aliases.length > 0) {
            user = await User.findOneAndUpdate(
                { userId },
                { $addToSet: { aliases: { $each: aliases } } },
                { new: true, projection: { userId: 1, aliases: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 } }
            );
        }

        res.json({
            ok: true,
            user: {
                userId: user.userId,
                aliases: Array.isArray(user.aliases) ? user.aliases : [],
                displayName: user.displayName || '',
                avatarUrl: user.avatarUrl || '',
                bio: user.bio || '',
            },
        });
    } catch (error) {
        console.error('User sync error:', error);
        res.status(500).json({ error: 'User sync failed' });
    }
});

/**
 * POST /users/me/reconcile
 * Moves legacy userId records to current auth userId and stores aliases.
 */
router.post('/me/reconcile', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        if (!userId) return res.status(400).json({ error: 'Invalid auth user' });

        const aliases = toAliasCandidates(req.auth);
        const me = await User.findOneAndUpdate(
            { userId },
            {
                $setOnInsert: { userId },
                ...(aliases.length > 0 ? { $addToSet: { aliases: { $each: aliases } } } : {}),
            },
            { upsert: true, new: true }
        );

        const aliasSet = new Set([userId, ...(Array.isArray(me.aliases) ? me.aliases : []), ...aliases]);
        const legacyIds = Array.from(aliasSet).filter((id) => id && id !== userId);
        if (legacyIds.length === 0) {
            return res.json({ ok: true, moved: { posts: 0, comments: 0, notifications: 0 }, mergedUsers: 0, legacyIds: [] });
        }

        const [postResult, commentResult, notifUserResult, notifFromResult, followersResult, followingResult] = await Promise.all([
            Post.updateMany({ userId: { $in: legacyIds } }, { $set: { userId } }),
            Comment.updateMany({ userId: { $in: legacyIds } }, { $set: { userId } }),
            Notification.updateMany({ userId: { $in: legacyIds } }, { $set: { userId } }),
            Notification.updateMany({ fromUserId: { $in: legacyIds } }, { $set: { fromUserId: userId } }),
            User.updateMany({ followers: { $in: legacyIds } }, { $addToSet: { followers: userId }, $pull: { followers: { $in: legacyIds } } }),
            User.updateMany({ following: { $in: legacyIds } }, { $addToSet: { following: userId }, $pull: { following: { $in: legacyIds } } }),
        ]);

        const staleUsers = await User.find({ userId: { $in: legacyIds } }, { userId: 1, aliases: 1, followers: 1, following: 1, _id: 0 });
        for (const stale of staleUsers) {
            await User.updateOne(
                { userId },
                { $addToSet: { aliases: { $each: [stale.userId, ...(stale.aliases || [])] } } }
            );
        }

        const deleteUsersResult = await User.deleteMany({ userId: { $in: legacyIds } });

        res.json({
            ok: true,
            legacyIds,
            moved: {
                posts: Number(postResult.modifiedCount || 0),
                comments: Number(commentResult.modifiedCount || 0),
                notifications: Number((notifUserResult.modifiedCount || 0) + (notifFromResult.modifiedCount || 0)),
                followersRefs: Number(followersResult.modifiedCount || 0),
                followingRefs: Number(followingResult.modifiedCount || 0),
            },
            mergedUsers: Number(deleteUsersResult.deletedCount || 0),
        });
    } catch (error) {
        console.error('User reconcile error:', error);
        res.status(500).json({ error: 'User reconcile failed' });
    }
});

/**
 * PUT /users/me/profile
 * Update displayName/bio for the signed-in user.
 */
router.put('/me/profile', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        if (!userId) return res.status(400).json({ error: 'Invalid auth user' });
        const displayName = String(req.body?.displayName || '').trim().slice(0, 120);
        const bio = String(req.body?.bio || '').trim().slice(0, 300);

        const user = await User.findOneAndUpdate(
            { userId },
            { $set: { displayName, bio } },
            { upsert: true, new: true, projection: { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 } }
        );

        res.json({ ok: true, user });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * POST /users/me/avatar
 * Upload avatar image to Storj and update user profile.
 */
router.post('/me/avatar', clerkAuth, avatarUpload.single('avatar'), async (req, res) => {
    try {
        const userId = req.auth.sub;
        if (!userId) return res.status(400).json({ error: 'Invalid auth user' });
        if (!req.file) return res.status(400).json({ error: 'avatar is required' });

        const ext = extFromMime(req.file.mimetype || '', 'jpg');
        const key = buildKey({ folder: 'alu-avatars', userId, prefix: 'avatar', ext });
        const avatarUrl = await uploadBuffer({
            buffer: req.file.buffer,
            contentType: req.file.mimetype || 'image/jpeg',
            key,
            cacheControl: 'public, max-age=86400',
        });

        await User.findOneAndUpdate(
            { userId },
            { $set: { avatarUrl, manualAvatarUrl: avatarUrl, avatarPreference: 'manual' } },
            { upsert: true }
        );

        res.json({ ok: true, avatarUrl });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
});

/**
 * POST /users/me/avatar-preference
 * Switch displayed avatar source between Alu-uploaded and Bluesky-synced avatar.
 */
router.post('/me/avatar-preference', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        if (!userId) return res.status(400).json({ error: 'Invalid auth user' });

        const source = String(req.body?.source || '').trim().toLowerCase();
        if (!['manual', 'bluesky'].includes(source)) {
            return res.status(400).json({ error: "source must be 'manual' or 'bluesky'" });
        }

        const user = await User.findOne(
            { userId },
            { avatarUrl: 1, manualAvatarUrl: 1, blueskyAvatarUrl: 1, avatarPreference: 1, _id: 0 }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        const preferredAvatar =
            source === 'bluesky'
                ? String(user.blueskyAvatarUrl || '').trim()
                : String(user.manualAvatarUrl || '').trim();

        if (!preferredAvatar) {
            return res.status(400).json({
                error: source === 'bluesky'
                    ? 'No synced Bluesky avatar yet. Use profile sync first.'
                    : 'No Alu avatar uploaded yet. Upload an avatar first.',
            });
        }

        const updated = await User.findOneAndUpdate(
            { userId },
            { $set: { avatarPreference: source, avatarUrl: preferredAvatar } },
            { new: true, projection: { avatarUrl: 1, avatarPreference: 1, _id: 0 } }
        );

        res.json({
            ok: true,
            avatarUrl: updated?.avatarUrl || '',
            avatarPreference: updated?.avatarPreference || source,
        });
    } catch (error) {
        console.error('Avatar preference error:', error);
        res.status(500).json({ error: 'Failed to switch avatar source' });
    }
});

/**
 * POST /users/lookup
 * Resolve multiple userIds to public profile summaries.
 * Body: { userIds: string[] }
 */
router.post('/lookup', clerkAuth, async (req, res) => {
    try {
        const input = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
        const uniqueIds = Array.from(
            new Set(
                input
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )
        ).slice(0, 200);

        if (uniqueIds.length === 0) return res.json({ users: [] });

        const users = await User.find(
            { userId: { $in: uniqueIds } },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 }
        );
        const userMap = new Map(users.map((u) => [u.userId, u]));

        const postFallbacks = await Post.aggregate([
            { $match: { userId: { $in: uniqueIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$userId',
                    displayName: { $first: '$displayName' },
                    avatarUrl: { $first: '$avatarUrl' },
                },
            },
        ]);
        const fallbackMap = new Map(
            postFallbacks.map((p) => [
                String(p._id || ''),
                { displayName: p.displayName || '', avatarUrl: p.avatarUrl || '' },
            ])
        );

        const result = uniqueIds.map((id) => {
            const user = userMap.get(id);
            const fallback = fallbackMap.get(id);
            return {
                userId: id,
                displayName: user?.displayName || fallback?.displayName || id,
                avatarUrl: user?.avatarUrl || fallback?.avatarUrl || '',
                bio: user?.bio || '',
            };
        });

        res.json({ users: result });
    } catch (error) {
        console.error('User lookup error:', error);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

/**
 * GET /users/:userId
 * Get a user's public profile (display info + post counts + follower counts)
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findOne(
            { userId },
            {
                userId: 1,
                displayName: 1,
                avatarUrl: 1,
                manualAvatarUrl: 1,
                blueskyAvatarUrl: 1,
                avatarPreference: 1,
                bio: 1,
                isPro: 1,
                followers: 1,
                following: 1,
                _id: 0,
            }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Count their public posts
        const latestIdentity = await getLatestPostIdentity(userId);
        const finalDisplayName = user.displayName || latestIdentity.displayName || user.userId;
        const preferredManualAvatar = String(user.manualAvatarUrl || '').trim();
        const preferredBlueskyAvatar = String(user.blueskyAvatarUrl || '').trim();
        const preferredAvatar =
            user.avatarPreference === 'bluesky'
                ? preferredBlueskyAvatar
                : preferredManualAvatar;
        const finalAvatarUrl = preferredAvatar || user.avatarUrl || latestIdentity.avatarUrl || '';

        if (finalDisplayName !== user.displayName || finalAvatarUrl !== user.avatarUrl) {
            await User.updateOne(
                { userId },
                { $set: { displayName: finalDisplayName, avatarUrl: finalAvatarUrl } }
            );
        }

        const [posts, shorts, videos] = await Promise.all([
            Post.countDocuments({ userId, mediaType: 'image', visibility: 'everyone' }),
            Post.countDocuments({ userId, mediaType: 'video', videoType: 'short', visibility: 'everyone' }),
            Post.countDocuments({ userId, mediaType: 'video', videoType: 'long', visibility: 'everyone' }),
        ]);

        res.json({
            userId: user.userId,
            displayName: finalDisplayName,
            avatarUrl: finalAvatarUrl,
            blueskyAvatarUrl: user.blueskyAvatarUrl || '',
            avatarPreference: user.avatarPreference || 'manual',
            bio: user.bio,
            isPro: user.isPro,
            followersCount: user.followers?.length || 0,
            followingCount: user.following?.length || 0,
            followers: user.followers || [],
            following: user.following || [],
            counts: { posts, shorts, videos },
        });
    } catch (error) {
        console.error('User profile error:', error);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

/**
 * POST /users/:userId/follow
 * Follow a user. Requires auth.
 */
router.post('/:userId/follow', clerkAuth, async (req, res) => {
    try {
        const myUserId = req.auth.sub;
        const targetUserId = req.params.userId;
        const { displayName, avatarUrl } = req.body;

        if (myUserId === targetUserId) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }

        // Add target to my following list
        await User.findOneAndUpdate(
            { userId: myUserId },
            { $addToSet: { following: targetUserId } },
            { upsert: true }
        );

        // Add me to target's followers list
        await User.findOneAndUpdate(
            { userId: targetUserId },
            { $addToSet: { followers: myUserId } },
            { upsert: true }
        );

        // Create notification for the target user
        await Notification.create({
            userId: targetUserId,
            type: 'follow',
            fromUserId: myUserId,
            fromDisplayName: displayName || '',
            fromAvatarUrl: avatarUrl || '',
        });

        res.json({ followed: true });
    } catch (error) {
        console.error('Follow error:', error);
        res.status(500).json({ error: 'Failed to follow user' });
    }
});

/**
 * POST /users/:userId/unfollow
 * Unfollow a user. Requires auth.
 */
router.post('/:userId/unfollow', clerkAuth, async (req, res) => {
    try {
        const myUserId = req.auth.sub;
        const targetUserId = req.params.userId;

        // Remove target from my following list
        await User.findOneAndUpdate(
            { userId: myUserId },
            { $pull: { following: targetUserId } }
        );

        // Remove me from target's followers list
        await User.findOneAndUpdate(
            { userId: targetUserId },
            { $pull: { followers: myUserId } }
        );

        res.json({ followed: false });
    } catch (error) {
        console.error('Unfollow error:', error);
        res.status(500).json({ error: 'Failed to unfollow user' });
    }
});

module.exports = router;
