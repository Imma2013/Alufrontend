const express = require('express');
const router = express.Router();
const { Post, Comment, Notification, User } = require('../config/db');
const clerkAuth = require('../middleware/clerkAuth');
const { notifyMentions } = require('../utils/mentions');
const { deletePublicUrl } = require('../services/storj');

const getAuthorizedUserIds = async (primaryUserId) => {
    const user = await User.findOne({ userId: primaryUserId }, { aliases: 1, _id: 0 });
    const set = new Set([primaryUserId]);
    const aliases = Array.isArray(user?.aliases) ? user.aliases : [];
    for (const alias of aliases) {
        const value = String(alias || '').trim();
        if (value) set.add(value);
    }
    return set;
};

const isOwnerByAliases = async (primaryUserId, ownerId) => {
    const ids = await getAuthorizedUserIds(primaryUserId);
    return ids.has(String(ownerId || '').trim());
};
// GET all liked posts for current user
router.get('/liked', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const posts = await Post.find({ likedBy: userId })
            .sort({ timestamp: -1 })
            .limit(200);

        const postsWithCounts = await Promise.all(
            posts.map(async (post) => {
                const commentCount = await Comment.countDocuments({ postId: post._id });
                return { ...post.toObject(), commentsCount: commentCount };
            })
        );

        res.json({ posts: postsWithCounts });
    } catch (err) {
        console.error('Get liked posts error:', err);
        res.status(500).json({ error: 'Failed to fetch liked posts' });
    }
});

router.get('/favorites', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const posts = await Post.find({ savedBy: userId })
            .sort({ timestamp: -1 })
            .limit(100);

        // Add comment counts
        const postsWithCounts = await Promise.all(
            posts.map(async (post) => {
                const commentCount = await Comment.countDocuments({ postId: post._id });
                return { ...post.toObject(), commentsCount: commentCount };
            })
        );

        res.json({ posts: postsWithCounts });
    } catch (err) {
        console.error('Get favorites error:', err);
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});

// ─── GET single post by ID (public — for share links) ───
router.get('/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const commentCount = await Comment.countDocuments({ postId: post._id });
        res.json({ post: { ...post.toObject(), commentCount } });
    } catch (err) {
        console.error('Get post error:', err);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
});

// ─── LIKE / UNLIKE a post ───
router.post('/:id/like', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const { displayName, avatarUrl } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const alreadyLiked = post.likedBy.includes(userId);

        if (alreadyLiked) {
            // Unlike
            post.likedBy = post.likedBy.filter(id => id !== userId);
            post.likes = Math.max(0, post.likes - 1);
            await post.save();
            return res.json({ liked: false, likes: post.likes });
        }

        // Like
        post.likedBy.push(userId);
        post.likes += 1;
        await post.save();

        // Create notification for post owner (don't notify yourself)
        if (post.userId !== userId) {
            await Notification.create({
                userId: post.userId,
                type: 'like',
                fromUserId: userId,
                fromDisplayName: displayName || '',
                fromAvatarUrl: avatarUrl || '',
                postId: post._id,
            });
        }

        res.json({ liked: true, likes: post.likes });
    } catch (err) {
        console.error('Like error:', err);
        res.status(500).json({ error: 'Failed to like post' });
    }
});

// ─── GET comments for a post ───
router.get('/:id/comments', async (req, res) => {
    try {
        // Get all comments for this post
        const allComments = await Comment.find({ postId: req.params.id })
            .sort({ createdAt: -1 })
            .limit(500);

        // Separate top-level comments from replies
        const topLevelComments = allComments.filter(c => !c.parentCommentId);
        const replies = allComments.filter(c => c.parentCommentId);

        // Add replyCount and nested replies to each top-level comment
        const commentsWithReplies = topLevelComments.map(comment => {
            const commentReplies = replies.filter(r =>
                r.parentCommentId && r.parentCommentId.toString() === comment._id.toString()
            );
            return {
                ...comment.toObject(),
                replyCount: commentReplies.length,
                replies: commentReplies.map(r => r.toObject())
            };
        });

        res.json({ comments: commentsWithReplies });
    } catch (err) {
        console.error('Get comments error:', err);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// ─── POST a comment ───
router.post('/:id/comments', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const { text, displayName, avatarUrl, parentCommentId, imageUrl } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        // If it's a reply, verify parent comment exists
        if (parentCommentId) {
            const parentComment = await Comment.findById(parentCommentId);
            if (!parentComment) {
                return res.status(404).json({ error: 'Parent comment not found' });
            }
        }

        const comment = await Comment.create({
            postId: post._id,
            userId,
            text: text.trim().slice(0, 500),
            displayName: displayName || '',
            avatarUrl: avatarUrl || '',
            parentCommentId: parentCommentId || null,
            imageUrl: imageUrl || '',
        });

        // Create notification
        if (parentCommentId) {
            // It's a reply - notify the parent comment author
            const parentComment = await Comment.findById(parentCommentId);
            if (parentComment && parentComment.userId !== userId) {
                await Notification.create({
                    userId: parentComment.userId,
                    type: 'reply',
                    fromUserId: userId,
                    fromDisplayName: displayName || '',
                    fromAvatarUrl: avatarUrl || '',
                    postId: post._id,
                    commentId: comment._id,
                    parentCommentId: parentCommentId,
                    commentText: text.trim().slice(0, 100),
                });
            }
        } else {
            // Top-level comment - notify post owner
            if (post.userId !== userId) {
                await Notification.create({
                    userId: post.userId,
                    type: 'comment',
                    fromUserId: userId,
                    fromDisplayName: displayName || '',
                    fromAvatarUrl: avatarUrl || '',
                    postId: post._id,
                    commentId: comment._id,
                    commentText: text.trim().slice(0, 100),
                });
            }
        }

        await notifyMentions({
            text: text.trim(),
            authorUserId: userId,
            authorDisplayName: displayName || '',
            authorAvatarUrl: avatarUrl || '',
            postId: post._id,
            commentId: comment._id,
        });

        res.status(201).json({ comment });
    } catch (err) {
        console.error('Comment error:', err);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// ─── LIKE / UNLIKE a comment ───
router.post('/:postId/comments/:commentId/like', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const { displayName, avatarUrl } = req.body;
        const comment = await Comment.findById(req.params.commentId);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        const alreadyLiked = comment.likedBy.includes(userId);

        if (alreadyLiked) {
            // Unlike
            comment.likedBy = comment.likedBy.filter(id => id !== userId);
            comment.likes = Math.max(0, comment.likes - 1);
            await comment.save();
            return res.json({ liked: false, likes: comment.likes });
        }

        // Like
        comment.likedBy.push(userId);
        comment.likes += 1;
        await comment.save();

        // Create notification for comment owner (don't notify yourself)
        if (comment.userId !== userId) {
            const post = await Post.findById(req.params.postId);
            await Notification.create({
                userId: comment.userId,
                type: 'comment_like',
                fromUserId: userId,
                fromDisplayName: displayName || '',
                fromAvatarUrl: avatarUrl || '',
                postId: post ? post._id : null,
                commentId: comment._id,
                commentText: comment.text.slice(0, 100),
            });
        }

        res.json({ liked: true, likes: comment.likes });
    } catch (err) {
        console.error('Comment like error:', err);
        res.status(500).json({ error: 'Failed to like comment' });
    }
});

// ─── DELETE a comment (by comment author or post owner) ───
router.delete('/:postId/comments/:commentId', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const post = await Post.findById(req.params.postId);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const comment = await Comment.findById(req.params.commentId);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        const authIds = await getAuthorizedUserIds(userId);
        const isCommentOwner = authIds.has(String(comment.userId || '').trim());
        const isPostOwner = authIds.has(String(post.userId || '').trim());
        if (!isCommentOwner && !isPostOwner) {
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }

        await Comment.deleteMany({ parentCommentId: comment._id });
        await comment.deleteOne();
        res.json({ deleted: true });
    } catch (err) {
        console.error('Delete comment error:', err);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// ─── UPDATE post caption (only by author) ───
router.put('/:id/caption', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const { caption } = req.body;
        const post = await Post.findById(req.params.id);

        if (!post) return res.status(404).json({ error: 'Post not found' });
        const canEdit = await isOwnerByAliases(userId, post.userId);
        if (!canEdit) return res.status(403).json({ error: 'Not authorized' });

        post.safePrompt = caption;
        post.caption = caption;
        await post.save();

        await notifyMentions({
            text: caption || '',
            authorUserId: userId,
            authorDisplayName: post.displayName || '',
            authorAvatarUrl: post.avatarUrl || '',
            postId: post._id,
        });

        res.json({ success: true, post });
    } catch (err) {
        console.error('Update caption error:', err);
        res.status(500).json({ error: 'Failed to update caption' });
    }
});

// ─── DELETE a post (only by author) ───
router.delete('/:id', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        const canDelete = await isOwnerByAliases(userId, post.userId);
        if (!canDelete) return res.status(403).json({ error: 'Not your post' });

        // Delete associated comments and notifications
        await Comment.deleteMany({ postId: post._id });
        await Notification.deleteMany({ postId: post._id });

        // Best-effort object cleanup from Storj.
        try {
            const urls = new Set([
                post.contentUrl,
                post.thumbnailUrl,
                ...(Array.isArray(post.images) ? post.images : []),
            ].filter(Boolean));
            await Promise.all(Array.from(urls).map((url) => deletePublicUrl(url).catch(() => false)));
        } catch (storjErr) {
            console.error('Storj delete failed (non-fatal):', storjErr.message);
        }

        await post.deleteOne();
        res.json({ deleted: true });
    } catch (err) {
        console.error('Delete post error:', err);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// ─── FAVORITE / UNFAVORITE a post ───
router.post('/:id/favorite', clerkAuth, async (req, res) => {
    try {
        const userId = req.auth.sub;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const alreadySaved = post.savedBy.includes(userId);

        if (alreadySaved) {
            // Unfavorite
            post.savedBy = post.savedBy.filter(id => id !== userId);
            await post.save();
            return res.json({ saved: false });
        }

        // Favorite
        post.savedBy.push(userId);
        await post.save();
        res.json({ saved: true });
    } catch (err) {
        console.error('Favorite error:', err);
        res.status(500).json({ error: 'Failed to favorite post' });
    }
});

// ─── GET all favorited posts for current user ───


module.exports = router;


