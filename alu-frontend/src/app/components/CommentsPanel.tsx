'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useState, useEffect, useRef } from 'react';
import { useAuth, useUser } from '../lib/auth';

interface CommentData {
    _id: string;
    userId: string;
    text: string;
    displayName: string;
    avatarUrl: string;
    createdAt: string;
    likes: number;
    likedBy: string[];
    imageUrl?: string;
    replyCount?: number;
    replies?: CommentData[];
}

interface CommentsPanelProps {
    postId: string;
    isOpen: boolean;
    onClose: () => void;
}

export default function CommentsPanel({ postId, isOpen, onClose }: CommentsPanelProps) {
    const { getToken } = useAuth();
    const { user } = useUser();
    const [comments, setComments] = useState<CommentData[]>([]);
    const [loading, setLoading] = useState(false);
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [replyingTo, setReplyingTo] = useState<CommentData | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
    const panelRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const backendUrl = BACKEND_URL;

    useEffect(() => {
        if (!isOpen || !postId) return;
        setLoading(true);
        fetch(`${backendUrl}/posts/${postId}/comments`)
            .then(res => res.ok ? res.json() : { comments: [] })
            .then(data => setComments(data.comments || []))
            .catch(() => setComments([]))
            .finally(() => setLoading(false));
    }, [isOpen, postId, backendUrl]);

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen, onClose]);

    const uploadImageToCloudinary = async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', 'alu_comments');

        const res = await fetch('https://api.cloudinary.com/v1_1/dqfvkvggd/image/upload', {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error('Image upload failed');
        const data = await res.json();
        return data.secure_url;
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async () => {
        if ((!text.trim() && !imageFile) || submitting) return;
        const token = await getToken();
        if (!token) return;

        setSubmitting(true);
        try {
            let imageUrl = '';
            if (imageFile) {
                setUploadingImage(true);
                imageUrl = await uploadImageToCloudinary(imageFile);
                setUploadingImage(false);
            }

            const res = await fetch(`${backendUrl}/posts/${postId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    text: text.trim() || '📷',
                    displayName: user?.fullName || '',
                    avatarUrl: user?.imageUrl || '',
                    parentCommentId: replyingTo?._id || null,
                    imageUrl,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (replyingTo) {
                    // Add reply to parent comment
                    setComments(prev => prev.map(c =>
                        c._id === replyingTo._id
                            ? { ...c, replies: [data.comment, ...(c.replies || [])], replyCount: (c.replyCount || 0) + 1 }
                            : c
                    ));
                    setExpandedReplies(prev => new Set(prev).add(replyingTo._id));
                } else {
                    setComments(prev => [{ ...data.comment, replies: [], replyCount: 0 }, ...prev]);
                }
                setText('');
                setImageFile(null);
                setImagePreview(null);
                setReplyingTo(null);
            }
        } finally {
            setSubmitting(false);
            setUploadingImage(false);
        }
    };

    const handleLike = async (commentId: string, isReply: boolean = false, parentId?: string) => {
        const token = await getToken();
        if (!token) return;

        try {
            const res = await fetch(`${backendUrl}/posts/${postId}/comments/${commentId}/like`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    displayName: user?.fullName || '',
                    avatarUrl: user?.imageUrl || '',
                }),
            });

            if (res.ok) {
                const { liked, likes } = await res.json();
                const userId = user?.id || '';

                if (isReply && parentId) {
                    setComments(prev => prev.map(c =>
                        c._id === parentId
                            ? {
                                ...c,
                                replies: c.replies?.map(r =>
                                    r._id === commentId
                                        ? {
                                            ...r,
                                            likes,
                                            likedBy: liked
                                                ? [...(r.likedBy || []), userId]
                                                : (r.likedBy || []).filter(id => id !== userId)
                                        }
                                        : r
                                ) || []
                            }
                            : c
                    ));
                } else {
                    setComments(prev => prev.map(c =>
                        c._id === commentId
                            ? {
                                ...c,
                                likes,
                                likedBy: liked
                                    ? [...(c.likedBy || []), userId]
                                    : (c.likedBy || []).filter(id => id !== userId)
                            }
                            : c
                    ));
                }
            }
        } catch (err) {
            console.error('Like error:', err);
        }
    };

    const handleDelete = async (commentId: string, isReply: boolean = false, parentId?: string) => {
        const token = await getToken();
        if (!token) return;

        const res = await fetch(`${backendUrl}/posts/${postId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (res.ok) {
            if (isReply && parentId) {
                setComments(prev => prev.map(c =>
                    c._id === parentId
                        ? {
                            ...c,
                            replies: c.replies?.filter(r => r._id !== commentId) || [],
                            replyCount: Math.max(0, (c.replyCount || 0) - 1)
                        }
                        : c
                ));
            } else {
                setComments(prev => prev.filter(c => c._id !== commentId));
            }
        }
    };

    const toggleReplies = (commentId: string) => {
        setExpandedReplies(prev => {
            const newSet = new Set(prev);
            if (newSet.has(commentId)) {
                newSet.delete(commentId);
            } else {
                newSet.add(commentId);
            }
            return newSet;
        });
    };

    const timeAgo = (date: string) => {
        const diff = Date.now() - new Date(date).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'now';
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    };

    const renderComment = (c: CommentData, isReply: boolean = false, parentId?: string) => {
        const isLiked = c.likedBy?.includes(user?.id || '') || false;
        const hasReplies = !isReply && (c.replyCount || 0) > 0;
        const repliesExpanded = expandedReplies.has(c._id);

        return (
            <div key={c._id} className={isReply ? 'ml-10' : ''}>
                <div className="flex gap-2.5 group">
                    {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary shrink-0">
                            {(c.displayName || 'U')[0].toUpperCase()}
                        </div>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-alu-text">{c.displayName || 'User'}</span>
                            <span className="text-xs text-alu-text-tertiary">{timeAgo(c.createdAt)}</span>
                        </div>
                        <p className="text-sm text-alu-text mt-0.5">{c.text}</p>
                        {c.imageUrl && (
                            <img src={c.imageUrl} alt="" className="mt-2 max-w-[200px] rounded-lg" />
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
                            <button
                                onClick={() => handleLike(c._id, isReply, parentId)}
                                className="text-xs font-semibold text-alu-text-tertiary hover:text-alu-text transition-colors"
                            >
                                {c.likes > 0 ? `${c.likes} ${c.likes === 1 ? 'like' : 'likes'}` : 'Like'}
                            </button>
                            {!isReply && (
                                <button
                                    onClick={() => setReplyingTo(c)}
                                    className="text-xs font-semibold text-alu-text-tertiary hover:text-alu-text transition-colors"
                                >
                                    Reply
                                </button>
                            )}
                            {c.userId === user?.id && (
                                <button
                                    onClick={() => handleDelete(c._id, isReply, parentId)}
                                    className="text-xs font-semibold text-alu-text-tertiary hover:text-red-500 transition-colors"
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </div>
                    {isLiked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#ed4956" className="shrink-0 mt-1">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                        </svg>
                    )}
                </div>

                {hasReplies && (
                    <button
                        onClick={() => toggleReplies(c._id)}
                        className="ml-10 mt-2 flex items-center gap-2 text-xs font-semibold text-alu-text-tertiary hover:text-alu-text transition-colors"
                    >
                        <div className="w-6 h-px bg-alu-border" />
                        {repliesExpanded ? 'Hide' : 'View'} {c.replyCount} {c.replyCount === 1 ? 'reply' : 'replies'}
                    </button>
                )}

                {repliesExpanded && c.replies && c.replies.length > 0 && (
                    <div className="mt-3 space-y-3">
                        {c.replies.map(reply => renderComment(reply, true, c._id))}
                    </div>
                )}
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center animate-fade-in">
            <div
                ref={panelRef}
                className="w-full max-w-[500px] bg-white rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-up"
                style={{ maxHeight: '70vh' }}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alu-border)]">
                    <h3 className="text-sm font-bold text-alu-text">Comments ({comments.length})</h3>
                    <button onClick={onClose} className="p-1 text-alu-text-tertiary hover:text-alu-text">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="overflow-y-auto px-4 py-3 flex flex-col gap-4" style={{ maxHeight: 'calc(70vh - 140px)' }}>
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <div className="w-6 h-6 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : comments.length === 0 ? (
                        <p className="text-center text-xs text-alu-text-tertiary py-6">No comments yet. Be the first!</p>
                    ) : (
                        comments.map(c => renderComment(c))
                    )}
                </div>

                <div className="border-t border-[var(--alu-border)] px-4 py-3">
                    {replyingTo && (
                        <div className="flex items-center justify-between mb-2 px-3 py-2 bg-alu-surface rounded-lg">
                            <span className="text-xs text-alu-text-secondary">
                                Replying to <span className="font-semibold">{replyingTo.displayName}</span>
                            </span>
                            <button
                                onClick={() => {
                                    setReplyingTo(null);
                                    setImageFile(null);
                                    setImagePreview(null);
                                }}
                                className="text-alu-text-tertiary hover:text-alu-text"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    )}

                    {imagePreview && (
                        <div className="mb-2 relative inline-block">
                            <img src={imagePreview} alt="Preview" className="max-w-[100px] rounded-lg" />
                            <button
                                onClick={() => {
                                    setImageFile(null);
                                    setImagePreview(null);
                                }}
                                className="absolute -top-2 -right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*"
                            onChange={handleImageSelect}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingImage}
                            className="h-10 w-10 rounded-full bg-alu-surface flex items-center justify-center text-alu-text-secondary hover:text-alu-text transition-colors disabled:opacity-50 shrink-0"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                            </svg>
                        </button>
                        <input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            placeholder="Add a comment..."
                            className="flex-1 h-10 px-3 bg-alu-surface rounded-full text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none focus:ring-2 focus:ring-[var(--alu-primary-glow)]"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || uploadingImage || (!text.trim() && !imageFile)}
                            className="h-10 px-4 rounded-full text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                        >
                            {uploadingImage ? '...' : submitting ? '...' : 'Post'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}



