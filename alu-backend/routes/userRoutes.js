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

const HANDLE_RESOLVE_TTL_MS = 30 * 1000;
const HANDLE_RESOLVE_MAX_ENTRIES = 1000;
const handleResolveCache = new Map();

const nowMs = () => Date.now();

const cacheGetHandleResolution = (key) => {
    const entry = handleResolveCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs()) {
        handleResolveCache.delete(key);
        return null;
    }
    return entry.value;
};

const cacheSetHandleResolution = (key, value) => {
    if (handleResolveCache.size >= HANDLE_RESOLVE_MAX_ENTRIES) {
        const firstKey = handleResolveCache.keys().next().value;
        if (firstKey) handleResolveCache.delete(firstKey);
    }
    handleResolveCache.set(key, {
        value,
        expiresAt: nowMs() + HANDLE_RESOLVE_TTL_MS,
    });
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeHandle = (value) => String(value || '').trim().toLowerCase().replace(/^@+/, '');

const handleCandidates = (raw) => {
    const normalized = normalizeHandle(raw);
    if (!normalized) return [];
    const set = new Set([normalized]);
    if (!normalized.includes('.')) {
        set.add(`${normalized}.bsky.social`);
    }
    if (normalized.endsWith('.bsky.social')) {
        set.add(normalized.replace(/\.bsky\.social$/, ''));
    }
    return Array.from(set);
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
        const includeExternal = String(req.query?.includeExternal || '').trim() === '1';

        // Escape regex special chars for safety
        const trimmed = q.trim();
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const users = await User.find(
            {
                ...(includeExternal ? {} : { isPlatformUser: true }),
                $or: [
                    { displayName: { $regex: escaped, $options: 'i' } },
                    { userId: { $regex: escaped, $options: 'i' } },
                    { aliases: { $regex: escaped, $options: 'i' } },
                ],
            },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, aliases: 1, _id: 0 }
        ).limit(20);

        const merged = new Map();
        for (const u of users) {
            merged.set(u.userId, {
                userId: u.userId,
                displayName: u.displayName || '',
                avatarUrl: u.avatarUrl || '',
                bio: u.bio || '',
                aliases: Array.isArray(u.aliases) ? u.aliases : [],
            });
        }

        const sorted = Array.from(merged.values())
            .sort((a, b) => {
                const aName = (a.displayName || '').toLowerCase();
                const bName = (b.displayName || '').toLowerCase();
                const aUser = String(a.userId || '').toLowerCase();
                const bUser = String(b.userId || '').toLowerCase();
                const aAliases = Array.isArray(a.aliases) ? a.aliases.map((v) => String(v || '').toLowerCase()) : [];
                const bAliases = Array.isArray(b.aliases) ? b.aliases.map((v) => String(v || '').toLowerCase()) : [];
                const query = trimmed.toLowerCase();
                const queryNoAt = query.startsWith('@') ? query.slice(1) : query;
                const queryBsky = queryNoAt.includes('.') ? queryNoAt : `${queryNoAt}.bsky.social`;
                const aExact = aName === query || aUser === query || aAliases.includes(query) || aAliases.includes(queryNoAt) || aAliases.includes(queryBsky);
                const bExact = bName === query || bUser === query || bAliases.includes(query) || bAliases.includes(queryNoAt) || bAliases.includes(queryBsky);
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                const aStarts = aName.startsWith(query) || aUser.startsWith(query) || aAliases.some((v) => v.startsWith(queryNoAt));
                const bStarts = bName.startsWith(query) || bUser.startsWith(query) || bAliases.some((v) => v.startsWith(queryNoAt));
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return aName.localeCompare(bName);
            })
            .slice(0, 20)
            .map(({ aliases, ...user }) => user);

        res.json({ users: sorted });
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /users/resolve-handle?handle=@name
 * Resolve a mention handle to a single user (exact match priority).
 */
router.get('/resolve-handle', async (req, res) => {
    try {
        const includeExternal = String(req.query?.includeExternal || '').trim() === '1';
        const rawHandle = String(req.query?.handle || req.query?.q || '').trim();
        const candidates = handleCandidates(rawHandle);
        if (candidates.length === 0) {
            return res.json({ user: null });
        }
        const cacheKey = `${includeExternal ? '1' : '0'}:${candidates.join('|')}`;
        const cached = cacheGetHandleResolution(cacheKey);
        if (cached) return res.json(cached);

        const exactRegex = candidates.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i'));
        const users = await User.find(
            {
                ...(includeExternal ? {} : { isPlatformUser: true }),
                $or: [
                    { userId: { $in: exactRegex } },
                    { aliases: { $in: exactRegex } },
                    { displayName: { $in: exactRegex } },
                ],
            },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, aliases: 1, _id: 0 }
        ).limit(25);

        const rank = (u) => {
            const userId = String(u.userId || '').trim().toLowerCase();
            const aliases = Array.isArray(u.aliases) ? u.aliases.map((a) => String(a || '').trim().toLowerCase()) : [];
            const displayName = String(u.displayName || '').trim().toLowerCase();
            for (const c of candidates) {
                if (userId === c) return 0;
                if (aliases.includes(c)) return 1;
                if (displayName === c) return 2;
            }
            return 9;
        };

        const resolved = users
            .map((u) => ({ ...u.toObject(), _rank: rank(u) }))
            .sort((a, b) => a._rank - b._rank)
            .find((u) => u._rank < 9);

        if (!resolved) {
            const payload = { user: null };
            cacheSetHandleResolution(cacheKey, payload);
            return res.json(payload);
        }
        const payload = {
            user: {
                userId: resolved.userId,
                displayName: resolved.displayName || resolved.userId,
                avatarUrl: resolved.avatarUrl || '',
                bio: resolved.bio || '',
            },
        };
        cacheSetHandleResolution(cacheKey, payload);
        return res.json(payload);
    } catch (error) {
        console.error('Resolve handle error:', error);
        res.status(500).json({ error: 'Handle resolve failed' });
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
            user = await User.create({ userId, aliases: aliases.length ? aliases : [userId], isPlatformUser: true });
        } else if (aliases.length > 0) {
            user = await User.findOneAndUpdate(
                { userId },
                { $addToSet: { aliases: { $each: aliases } }, $set: { isPlatformUser: true } },
                { new: true, projection: { userId: 1, aliases: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 } }
            );
        } else {
            user = await User.findOneAndUpdate(
                { userId },
                { $set: { isPlatformUser: true } },
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
                $setOnInsert: { userId, isPlatformUser: true },
                $set: { isPlatformUser: true },
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
            { $set: { displayName, bio, isPlatformUser: true } },
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
            { $set: { avatarUrl, manualAvatarUrl: avatarUrl, avatarPreference: 'manual', isPlatformUser: true } },
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
        const includeExternal = String(req.query?.includeExternal || '').trim() === '1';
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
            { userId: { $in: uniqueIds }, ...(includeExternal ? {} : { isPlatformUser: true }) },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, _id: 0 }
        );
        const userMap = new Map(users.map((u) => [u.userId, u]));

        const result = uniqueIds.map((id) => {
            const user = userMap.get(id);
            if (!user) return null;
            return {
                userId: id,
                displayName: user?.displayName || id,
                avatarUrl: user?.avatarUrl || '',
                bio: user?.bio || '',
            };
        }).filter(Boolean);

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
        const includeExternal = String(req.query?.includeExternal || '').trim() === '1';

        const user = await User.findOne(
            { userId },
            {
                userId: 1,
                isPlatformUser: 1,
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
        if (!includeExternal && user.isPlatformUser !== true) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Count their public posts
        const latestIdentity = await getLatestPostIdentity(userId);
        const finalDisplayName = user.displayName || latestIdentity.displayName || user.userId;
        const preferredManualAvatar = String(user.manualAvatarUrl || '').trim();
        const preferredBlueskyAvatar = String(user.blueskyAvatarUrl || '').trim();
        const preferredAvatar =
            user.avatarPreference === 'bluesky'
                ? (preferredBlueskyAvatar || preferredManualAvatar)
                : (preferredManualAvatar || preferredBlueskyAvatar);
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
            manualAvatarUrl: user.manualAvatarUrl || '',
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
