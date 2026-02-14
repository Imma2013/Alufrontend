const express = require('express');
const clerkAuth = require('../middleware/clerkAuth');
const { User, Post, Notification } = require('../config/db');

const router = express.Router();

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
            { displayName: { $regex: escaped, $options: 'i' } },
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
            if (!userId || merged.has(userId)) continue;
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
 * GET /users/:userId
 * Get a user's public profile (display info + post counts + follower counts)
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findOne(
            { userId },
            { userId: 1, displayName: 1, avatarUrl: 1, bio: 1, isPro: 1, followers: 1, following: 1, _id: 0 }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Count their public posts
        const [posts, shorts, videos] = await Promise.all([
            Post.countDocuments({ userId, mediaType: 'image', visibility: 'everyone' }),
            Post.countDocuments({ userId, mediaType: 'video', videoType: 'short', visibility: 'everyone' }),
            Post.countDocuments({ userId, mediaType: 'video', videoType: 'long', visibility: 'everyone' }),
        ]);

        res.json({
            userId: user.userId,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
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
