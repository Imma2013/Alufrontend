'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { HeartIcon, ShareIcon, AluLogo } from '../../components/icons';

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
    commentCount?: number;
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

interface VideoQualityOption {
    id: string;
    label: string;
    src: string;
}

const buildQualityOptions = (url: string): VideoQualityOption[] => {
    if (!url || !url.startsWith('http')) return [{ id: 'auto', label: 'Auto', src: url }];

    const uploadToken = '/video/upload/';
    const uploadIdx = url.indexOf(uploadToken);
    if (uploadIdx === -1 || !url.includes('res.cloudinary.com')) {
        return [{ id: 'auto', label: 'Auto', src: url }];
    }

    const prefix = url.slice(0, uploadIdx + uploadToken.length);
    const suffix = url.slice(uploadIdx + uploadToken.length);
    const strippedSuffix = suffix.replace(/^([^/]+)\//, (segment) => {
        if (segment.includes('q_') || segment.includes('w_') || segment.includes('c_') || segment.includes('f_')) {
            return '';
        }
        return segment;
    });

    const presets: Array<{ id: string; label: string; transform: string }> = [
        { id: 'auto', label: 'Auto', transform: 'f_auto,q_auto' },
        { id: '2160p', label: '2160p (4K)', transform: 'f_auto,q_auto:best,c_limit,w_3840' },
        { id: '1440p', label: '1440p', transform: 'f_auto,q_auto:best,c_limit,w_2560' },
        { id: '1080p', label: '1080p', transform: 'f_auto,q_auto:good,c_limit,w_1920' },
        { id: '720p', label: '720p', transform: 'f_auto,q_auto:good,c_limit,w_1280' },
        { id: '480p', label: '480p', transform: 'f_auto,q_auto:eco,c_limit,w_854' },
        { id: '360p', label: '360p', transform: 'f_auto,q_auto:eco,c_limit,w_640' },
    ];

    return presets.map((preset) => ({
        id: preset.id,
        label: preset.label,
        src: `${prefix}${preset.transform}/${strippedSuffix}`,
    }));
};

export default function WatchPage() {
    const params = useParams();
    const router = useRouter();
    const postId = params.id as string;
    const { getToken } = useAuth();
    const { user } = useUser();
    const [post, setPost] = useState<PostData | null>(null);
    const [relatedPosts, setRelatedPosts] = useState<PostData[]>([]);
    const [comments, setComments] = useState<CommentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [liked, setLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(0);
    const [commentText, setCommentText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showDescription, setShowDescription] = useState(false);
    const [qualityOpen, setQualityOpen] = useState(false);
    const [qualityOptions, setQualityOptions] = useState<VideoQualityOption[]>([]);
    const [selectedQuality, setSelectedQuality] = useState<string>('auto');
    const [videoSrc, setVideoSrc] = useState('');
    const videoRef = useRef<HTMLVideoElement>(null);
    const qualityMenuRef = useRef<HTMLDivElement>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const resumeAfterSwitchRef = useRef(false);

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch main post
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

                // Fetch related posts (same user's videos, or just latest videos)
                try {
                    const token = await getToken();
                    const syncRes = await fetch(`${backendUrl}/sync/pull`, {
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    });
                    if (syncRes.ok) {
                        const syncData = await syncRes.json();
                        const videos = (syncData.posts || [])
                            .filter((p: PostData) => p.mediaType === 'video' && p._id !== postId)
                            .slice(0, 10);
                        setRelatedPosts(videos);
                    }
                } catch { /* ignore related posts error */ }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load');
            } finally {
                setLoading(false);
            }
        };
        if (postId) fetchData();
    }, [postId, backendUrl, user?.id, getToken]);

    useEffect(() => {
        if (!post?.contentUrl) return;
        const options = buildQualityOptions(post.contentUrl);
        setQualityOptions(options);
        setSelectedQuality('auto');
        setVideoSrc(options[0]?.src || post.contentUrl);
    }, [post?.contentUrl]);

    useEffect(() => {
        if (!qualityOpen) return;
        const onClickOutside = (event: MouseEvent) => {
            if (qualityMenuRef.current && !qualityMenuRef.current.contains(event.target as Node)) {
                setQualityOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [qualityOpen]);

    const handleLike = async () => {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${backendUrl}/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
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
                body: JSON.stringify({ text: commentText.trim(), displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
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
        const url = window.location.href;
        try {
            if (navigator.share) await navigator.share({ title: 'Check this out on Alu', url });
            else { await navigator.clipboard.writeText(url); alert('Link copied!'); }
        } catch { /* silent */ }
    };

    const handleQualityChange = (option: VideoQualityOption) => {
        if (option.id === selectedQuality || !videoRef.current) {
            setSelectedQuality(option.id);
            setQualityOpen(false);
            return;
        }

        pendingSeekRef.current = videoRef.current.currentTime;
        resumeAfterSwitchRef.current = !videoRef.current.paused;
        setSelectedQuality(option.id);
        setVideoSrc(option.src);
        setQualityOpen(false);
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
                <button onClick={() => router.push('/')} className="shrink-0 flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <AluLogo size={22} />
                </button>
                <div className="flex-1" />
                <a href="/" className="text-sm text-[var(--alu-primary)] font-medium hover:underline">← Back to Feed</a>
            </header>

            {/* YouTube-style layout */}
            <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-6 p-4 lg:p-6">
                {/* LEFT: Main video + info + comments */}
                <div className="flex-1 min-w-0">
                    {/* Video player */}
                    <div className="relative w-full bg-black rounded-xl overflow-hidden" style={{ aspectRatio: post.videoType === 'short' ? '9/16' : '16/9', maxHeight: '70vh' }}>
                        {post.mediaType === 'video' ? (
                            <>
                                <video
                                    ref={videoRef}
                                    src={videoSrc || post.contentUrl}
                                    controls
                                    autoPlay
                                    className="w-full h-full object-contain"
                                    onLoadedMetadata={() => {
                                        if (!videoRef.current) return;
                                        if (pendingSeekRef.current !== null) {
                                            videoRef.current.currentTime = pendingSeekRef.current;
                                            pendingSeekRef.current = null;
                                        }
                                        if (resumeAfterSwitchRef.current) {
                                            void videoRef.current.play().catch(() => {});
                                            resumeAfterSwitchRef.current = false;
                                        }
                                    }}
                                />
                                <div className="absolute top-3 right-3 z-10" ref={qualityMenuRef}>
                                    <button
                                        onClick={() => setQualityOpen((prev) => !prev)}
                                        className="h-8 px-2.5 rounded-md bg-black/60 text-white text-xs font-medium hover:bg-black/75 transition-colors"
                                        aria-label="Video quality"
                                    >
                                        {qualityOptions.find((q) => q.id === selectedQuality)?.label || 'Auto'}
                                    </button>
                                    {qualityOpen && (
                                        <div className="absolute right-0 mt-2 w-[148px] rounded-lg bg-[#1f1f1f]/95 border border-white/10 shadow-xl overflow-hidden">
                                            {qualityOptions.map((option) => (
                                                <button
                                                    key={option.id}
                                                    onClick={() => handleQualityChange(option)}
                                                    className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                                                        selectedQuality === option.id
                                                            ? 'bg-white/10 text-white font-semibold'
                                                            : 'text-white/85 hover:bg-white/10'
                                                    }`}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <img src={post.contentUrl} alt={post.safePrompt} className="w-full h-full object-contain" />
                        )}
                    </div>

                    {/* Video info */}
                    <div className="mt-3">
                        <h1 className="text-lg font-semibold text-alu-text leading-snug">{post.safePrompt || 'Untitled'}</h1>

                        <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
                            {/* Creator info */}
                            <div className="flex items-center gap-3">
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
                                {post.is_ai && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--alu-primary-glow)] text-[var(--alu-primary)]">AI Generated</span>}
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleLike}
                                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${liked
                                        ? 'bg-red-50 text-red-500 border border-red-200'
                                        : 'bg-alu-surface text-alu-text-secondary hover:bg-[var(--alu-hover)]'
                                        }`}
                                >
                                    <HeartIcon size={18} />
                                    <span>{likeCount}</span>
                                </button>

                                <button
                                    onClick={handleShare}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-alu-surface text-alu-text-secondary hover:bg-[var(--alu-hover)] transition-colors"
                                >
                                    <ShareIcon size={18} />
                                    <span>Share</span>
                                </button>
                            </div>
                        </div>

                        {/* Description (expandable) */}
                        {post.safePrompt && post.safePrompt !== 'User upload' && (
                            <div
                                className="mt-3 p-3 bg-alu-surface rounded-xl cursor-pointer hover:bg-[var(--alu-hover)] transition-colors"
                                onClick={() => setShowDescription(!showDescription)}
                            >
                                <p className={`text-sm text-alu-text ${showDescription ? '' : 'line-clamp-2'}`}>{post.safePrompt}</p>
                                <span className="text-xs text-alu-text-tertiary mt-1 inline-block">{showDescription ? 'Show less' : 'Show more'}</span>
                            </div>
                        )}
                    </div>

                    {/* Comments section */}
                    <div className="mt-6">
                        <h3 className="text-base font-semibold text-alu-text mb-4">{comments.length} Comments</h3>

                        {/* Add comment */}
                        <div className="flex gap-3 mb-6">
                            {user?.imageUrl ? (
                                <img src={user.imageUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                            ) : (
                                <div className="w-9 h-9 rounded-full bg-alu-surface shrink-0" />
                            )}
                            <div className="flex-1">
                                <input
                                    type="text"
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleComment()}
                                    placeholder="Add a comment..."
                                    className="w-full h-10 px-0 border-b border-[var(--alu-border)] bg-transparent text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none focus:border-[var(--alu-primary)] transition-colors"
                                />
                                {commentText.trim() && (
                                    <div className="flex justify-end gap-2 mt-2">
                                        <button onClick={() => setCommentText('')} className="px-3 py-1.5 text-xs font-medium text-alu-text-secondary hover:bg-alu-surface rounded-full">Cancel</button>
                                        <button
                                            onClick={handleComment}
                                            disabled={submitting}
                                            className="px-3 py-1.5 text-xs font-semibold text-white rounded-full disabled:opacity-50"
                                            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                                        >
                                            {submitting ? 'Posting...' : 'Comment'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Comment list */}
                        <div className="flex flex-col gap-4">
                            {comments.map((c) => (
                                <div key={c._id} className="flex gap-3 group">
                                    {c.avatarUrl ? (
                                        <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary shrink-0">
                                            {(c.displayName || 'U')[0].toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-xs">
                                            <span className="font-semibold text-alu-text">{c.displayName || 'User'}</span>
                                            <span className="text-alu-text-tertiary ml-2">{timeAgo(c.createdAt)}</span>
                                        </p>
                                        <p className="text-sm text-alu-text mt-1">{c.text}</p>
                                    </div>
                                </div>
                            ))}
                            {comments.length === 0 && (
                                <p className="text-sm text-alu-text-tertiary text-center py-8">No comments yet. Be the first!</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Related videos sidebar */}
                <div className="w-full lg:w-[360px] shrink-0">
                    <h3 className="text-sm font-bold text-alu-text mb-3">Related</h3>
                    <div className="flex flex-col gap-3">
                        {relatedPosts.length === 0 ? (
                            <p className="text-xs text-alu-text-tertiary text-center py-4">No related videos yet</p>
                        ) : (
                            relatedPosts.map((rp) => (
                                <button
                                    key={rp._id}
                                    onClick={() => router.push(`/watch/${rp._id}`)}
                                    className="flex gap-3 text-left hover:bg-alu-surface rounded-xl p-2 transition-colors"
                                >
                                    {/* Thumbnail */}
                                    <div className="w-[168px] h-[94px] rounded-lg bg-black overflow-hidden shrink-0 relative">
                                        {rp.thumbnailUrl ? (
                                            <img src={rp.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <video src={rp.contentUrl} className="w-full h-full object-cover" muted preload="metadata" />
                                        )}
                                        {rp.is_ai && (
                                            <span className="absolute top-1 left-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-black/50 text-white">AI</span>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-alu-text line-clamp-2">{rp.safePrompt || 'Untitled'}</p>
                                        <p className="text-xs text-alu-text-tertiary mt-1">{rp.displayName || 'Alu User'}</p>
                                        <p className="text-xs text-alu-text-tertiary">{timeAgo(rp.timestamp)}</p>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
