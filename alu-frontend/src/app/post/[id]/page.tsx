'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { getPostShareUrl } from '@/app/lib/publicUrl';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { HeartIcon, CommentIcon, ShareIcon, AluLogo } from '../../components/icons';

interface PostData {
    _id: string;
    userId: string;
    contentUrl: string;
    safePrompt: string;
    mediaType: 'image' | 'video';
    videoType?: string;
    is_ai: boolean;
    likes: number;
    likedBy: string[];
    displayName: string;
    avatarUrl: string;
    commentCount: number;
    timestamp: string;
    thumbnailUrl?: string;
}

interface CommentData {
    _id: string;
    userId: string;
    text: string;
    displayName: string;
    avatarUrl: string;
    createdAt: string;
}

export default function PostPage() {
    const params = useParams();
    const postId = params.id as string;
    const { getToken } = useAuth();
    const { user } = useUser();
    const [post, setPost] = useState<PostData | null>(null);
    const [comments, setComments] = useState<CommentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [liked, setLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(0);
    const [commentText, setCommentText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const backendUrl = BACKEND_URL;

    useEffect(() => {
        const fetchPost = async () => {
            try {
                const res = await fetch(`${backendUrl}/posts/${postId}`);
                if (!res.ok) throw new Error('Post not found');
                const data = await res.json();
                setPost(data.post);
                setLikeCount(data.post.likes);
                setLiked(data.post.likedBy?.includes(user?.id || '') || false);

                // Fetch comments
                const commentsRes = await fetch(`${backendUrl}/posts/${postId}/comments`);
                if (commentsRes.ok) {
                    const commentsData = await commentsRes.json();
                    setComments(commentsData.comments);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load post');
            } finally {
                setLoading(false);
            }
        };
        if (postId) fetchPost();
    }, [postId, backendUrl, user?.id]);

    const handleLike = async () => {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${backendUrl}/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                displayName: user?.fullName || '',
                avatarUrl: user?.imageUrl || '',
            }),
        });
        if (res.ok) {
            const data = await res.json();
            setLiked(data.liked);
            setLikeCount(data.likes);
        }
    };

    const handleComment = async () => {
        if (!commentText.trim() || submitting) return;
        const token = await getToken();
        if (!token) return;
        setSubmitting(true);
        try {
            const res = await fetch(`${backendUrl}/posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    text: commentText.trim(),
                    displayName: user?.fullName || '',
                    avatarUrl: user?.imageUrl || '',
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setComments(prev => [data.comment, ...prev]);
                setCommentText('');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleShare = async () => {
        const url = getPostShareUrl(postId);
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Check this out on Alu', url });
            } else {
                await navigator.clipboard.writeText(url);
                alert('Link copied!');
            }
        } catch { /* silent */ }
    };

    const timeAgo = (date: string) => {
        const diff = Date.now() - new Date(date).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--alu-bg)] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error || !post) {
        return (
            <div className="min-h-screen bg-[var(--alu-bg)] flex items-center justify-center">
                <div className="text-center">
                    <AluLogo size={32} />
                    <p className="text-alu-text mt-4 font-semibold">Post not found</p>
                    <a href="/" className="text-sm text-[var(--alu-primary)] mt-2 inline-block hover:underline">← Back to Alu</a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--alu-bg)]">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)] h-14 flex items-center px-4 gap-3">
                <a href="/" className="shrink-0"><AluLogo size={22} /></a>
                <div className="flex-1" />
                <a href="/" className="text-sm text-[var(--alu-primary)] font-medium hover:underline">Open in Alu</a>
            </header>

            <div className="max-w-[900px] mx-auto flex flex-col md:flex-row gap-6 p-4">
                {/* Media */}
                <div className="flex-1">
                    <div className={`rounded-2xl overflow-hidden bg-black ${post.mediaType === 'video' && post.videoType !== 'long' ? 'aspect-[9/16] max-w-[400px] mx-auto' : 'aspect-video'}`}>
                        {post.mediaType === 'image' ? (
                            <img src={post.contentUrl} alt={post.safePrompt} className="w-full h-full object-contain" />
                        ) : (
                            <video src={post.contentUrl} controls autoPlay className="w-full h-full object-contain" />
                        )}
                    </div>

                    {/* Actions + info BELOW media */}
                    <div className="mt-4">
                        <div className="flex items-center gap-3 mb-3">
                            {post.avatarUrl ? (
                                <img src={post.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-alu-surface flex items-center justify-center text-sm font-bold text-alu-text-secondary">
                                    {(post.displayName || 'U')[0].toUpperCase()}
                                </div>
                            )}
                            <div>
                                <p className="text-sm font-semibold text-alu-text">{post.displayName || 'Alu User'}</p>
                                <p className="text-xs text-alu-text-tertiary">{timeAgo(post.timestamp)}</p>
                            </div>
                            {post.is_ai && <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--alu-primary-glow)] text-[var(--alu-primary)]">AI</span>}
                        </div>

                        {post.safePrompt && post.safePrompt !== 'User upload' && (
                            <p className="text-sm text-alu-text mb-3">{post.safePrompt}</p>
                        )}

                        {/* Like / Comment / Share buttons */}
                        <div className="flex items-center gap-4 py-3 border-t border-b border-[var(--alu-border)]">
                            <button onClick={handleLike} className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${liked ? 'text-red-500' : 'text-alu-text-secondary hover:text-alu-text'}`}>
                                <HeartIcon size={20} />
                                <span>{likeCount}</span>
                            </button>
                            <button className="flex items-center gap-1.5 text-sm font-medium text-alu-text-secondary">
                                <CommentIcon size={20} />
                                <span>{comments.length}</span>
                            </button>
                            <button onClick={handleShare} className="flex items-center gap-1.5 text-sm font-medium text-alu-text-secondary hover:text-alu-text ml-auto">
                                <ShareIcon size={20} />
                                <span>Share</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Comments sidebar (desktop) or below (mobile) */}
                <div className="w-full md:w-[340px] shrink-0">
                    <h3 className="text-sm font-bold text-alu-text mb-3">Comments ({comments.length})</h3>

                    {/* Add comment */}
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleComment()}
                            placeholder="Add a comment..."
                            className="flex-1 h-10 px-3 bg-alu-surface rounded-full text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none focus:ring-2 focus:ring-[var(--alu-primary-glow)]"
                        />
                        <button
                            onClick={handleComment}
                            disabled={submitting || !commentText.trim()}
                            className="h-10 px-4 rounded-full text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                        >
                            {submitting ? '...' : 'Post'}
                        </button>
                    </div>

                    {/* Comment list */}
                    <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
                        {comments.length === 0 ? (
                            <p className="text-xs text-alu-text-tertiary text-center py-4">No comments yet. Be the first!</p>
                        ) : (
                            comments.map((c) => (
                                <div key={c._id} className="flex gap-2">
                                    {c.avatarUrl ? (
                                        <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary shrink-0">
                                            {(c.displayName || 'U')[0].toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-xs">
                                            <span className="font-semibold text-alu-text">{c.displayName || 'User'}</span>
                                            <span className="text-alu-text-tertiary ml-1.5">{timeAgo(c.createdAt)}</span>
                                        </p>
                                        <p className="text-sm text-alu-text mt-0.5">{c.text}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
