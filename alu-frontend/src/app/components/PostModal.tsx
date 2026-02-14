'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, useUser } from '@clerk/nextjs';
import { Post, db } from '../db';
import { HeartIcon, CommentIcon, ShareIcon, BookmarkIcon, MoreVertIcon } from './icons';
import ImageCarousel from './ImageCarousel';

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

interface PostModalProps {
  post: Post;
  onClose: () => void;
  onViewUser?: (userId: string) => void;
  onDeleted?: (postId: string) => void;
  openComments?: boolean;
}

export default function PostModal({ post, onClose, onViewUser, onDeleted, openComments = false }: PostModalProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [likedByMe, setLikedByMe] = useState(post.likedBy?.includes(user?.id || '') || false);
  const [saved, setSaved] = useState(post.savedBy?.includes(user?.id || '') || false);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommentData | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOwnerOptions, setShowOwnerOptions] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const isOwner = post.userId === user?.id;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Scroll modal content to top on mount and when post changes
  useEffect(() => {
    setMediaLoaded(!(post.mediaType === 'image' && !!post.images && post.images.length > 1));
    if (modalContentRef.current) {
      modalContentRef.current.scrollTop = 0;
    }
  }, [post._id, post.mediaType, post.images]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setLoadingComments(true);
    fetch(`${backendUrl}/posts/${post._id}/comments`)
      .then(res => res.ok ? res.json() : { comments: [] })
      .then(data => setComments(data.comments || []))
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [post._id, backendUrl]);

  useEffect(() => {
    if (!openComments) return;
    const timer = setTimeout(() => {
      if (commentsSectionRef.current) {
        commentsSectionRef.current.scrollTop = 0;
      }
      commentInputRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [openComments, post._id]);

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

  const toggleLike = async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${backendUrl}/posts/${post._id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
      });
      if (res.ok) {
        const data = await res.json();
        setLikeCount(data.likes);
        setLikedByMe(data.liked);
      }
    } catch (err) {
      console.error('Like failed:', err);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/post/${post._id}`;
    const shareData = {
      title: 'Check this out on Alu',
      text: post.safePrompt || 'Shared from Alu',
      url: shareUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      try { await navigator.clipboard.writeText(shareUrl); } catch { /* silent */ }
    }
  };

  const copyPostLink = async () => {
    const url = `${window.location.origin}/post/${post._id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const handleViewUser = () => {
    if (post.userId && onViewUser) {
      onViewUser(post.userId);
      onClose();
    }
  };

  const toggleSave = async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`${backendUrl}/posts/${post._id}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSaved(data.saved);

        // Update Dexie
        const userId = user?.id || '';
        await db.posts.update(post._id, {
          savedBy: data.saved
            ? [...(post.savedBy || []), userId]
            : (post.savedBy || []).filter(id => id !== userId)
        });
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const submitComment = async () => {
    if ((!commentText.trim() && !imageFile) || submittingComment) return;
    const token = await getToken();
    if (!token) return;

    setSubmittingComment(true);
    try {
      let imageUrl = '';
      if (imageFile) {
        setUploadingImage(true);
        imageUrl = await uploadImageToCloudinary(imageFile);
        setUploadingImage(false);
      }

      const res = await fetch(`${backendUrl}/posts/${post._id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          text: commentText.trim() || '[image]',
          displayName: user?.fullName || '',
          avatarUrl: user?.imageUrl || '',
          parentCommentId: replyingTo?._id || null,
          imageUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (replyingTo) {
          setComments(prev => prev.map(c =>
            c._id === replyingTo._id
              ? { ...c, replies: [data.comment, ...(c.replies || [])], replyCount: (c.replyCount || 0) + 1 }
              : c
          ));
          setExpandedReplies(prev => new Set(prev).add(replyingTo._id));
        } else {
          setComments(prev => [{ ...data.comment, replies: [], replyCount: 0 }, ...prev]);
        }
        setCommentText('');
        setImageFile(null);
        setImagePreview(null);
        setReplyingTo(null);
      }
    } finally {
      setSubmittingComment(false);
      setUploadingImage(false);
    }
  };

  const handleCommentLike = async (commentId: string, isReply: boolean = false, parentId?: string) => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`${backendUrl}/posts/${post._id}/comments/${commentId}/like`, {
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

  const deleteComment = async (commentId: string, isReply: boolean = false, parentId?: string) => {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${backendUrl}/posts/${post._id}/comments/${commentId}`, {
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

  const deletePost = async () => {
    const token = await getToken();
    if (!token) return;
    setDeleting(true);
    try {
      const res = await fetch(`${backendUrl}/posts/${post._id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        try { await db.posts.delete(post._id); } catch { /* ok */ }
        onDeleted?.(post._id);
        onClose();
      }
    } catch (err) {
      console.error('Delete post failed:', err);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const timeAgo = (date: Date | string) => {
    const now = Date.now();
    const diff = now - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
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
            <div className="w-8 h-8 rounded-full bg-[#f2f2f2] flex items-center justify-center text-xs font-bold text-[#8e8e8e] shrink-0">
              {(c.displayName || 'U')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#262626]">{c.displayName || 'User'}</span>
              <span className="text-xs text-[#8e8e8e]">{timeAgo(c.createdAt)}</span>
            </div>
            <p className="text-sm text-[#262626] mt-0.5 leading-[1.35]">{c.text}</p>
            {c.imageUrl && (
              <img src={c.imageUrl} alt="" className="mt-2 max-w-[150px] rounded-lg" />
            )}
            <div className="flex items-center gap-3 mt-1.5">
              <button
                onClick={() => handleCommentLike(c._id, isReply, parentId)}
                className="text-xs font-semibold text-[#8e8e8e] hover:text-[#262626] transition-colors"
              >
                {c.likes > 0 ? `${c.likes} ${c.likes === 1 ? 'like' : 'likes'}` : 'Like'}
              </button>
              {!isReply && (
                <button
                  onClick={() => setReplyingTo(c)}
                  className="text-xs font-semibold text-[#8e8e8e] hover:text-[#262626] transition-colors"
                >
                  Reply
                </button>
              )}
              {c.userId === user?.id && (
                <button
                  onClick={() => deleteComment(c._id, isReply, parentId)}
                  className="text-xs font-semibold text-[#8e8e8e] hover:text-red-500 transition-colors"
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
            className="ml-10 mt-2 flex items-center gap-2 text-xs font-semibold text-[#8e8e8e] hover:text-[#262626] transition-colors"
          >
            <div className="w-6 h-px bg-[#dbdbdb]" />
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

  if (!mounted) return null;

  const modal = (
    <div className="contents">
      <div className="fixed inset-0 z-[100] bg-black/75 flex items-stretch md:items-center justify-center p-0 md:p-4 overflow-hidden" onClick={onClose}>
      <div
        className="relative bg-white w-full h-[100dvh] md:h-[88vh] md:max-h-[88vh] md:max-w-[1180px] rounded-none md:rounded-[6px] overflow-hidden animate-fade-in flex flex-col md:flex-row border border-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div
          className={`w-full md:flex-1 h-[46dvh] md:h-full flex items-center justify-center relative flex-shrink-0 ${post.mediaType === 'image' ? 'bg-[#fafafa]' : 'bg-black'}`}
          style={{ minHeight: '240px' }}
        >
          {/* Loading spinner */}
          {!mediaLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
              <div className="w-12 h-12 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {post.mediaType === 'image' ? (
            <div className="w-full h-full flex items-center justify-center">
              {post.images && post.images.length > 1 ? (
                <div className="w-full h-full">
                  <ImageCarousel images={post.images} />
                </div>
              ) : (
                <img
                  src={post.contentUrl}
                  alt={post.safePrompt}
                  className="object-cover w-full h-full"
                  onLoad={() => setMediaLoaded(true)}
                  onError={() => setMediaLoaded(true)}
                />
              )}
            </div>
          ) : (
            <div className="w-full h-full relative">
              <video
                src={post.contentUrl}
                controls
                playsInline
                className="object-contain w-full h-full"
                onLoadedData={() => setMediaLoaded(true)}
                onError={() => setMediaLoaded(true)}
              />
            </div>
          )}
          {post.is_ai && (
            <div className="absolute top-3 left-3 text-[10px] font-bold px-2 py-0.5 rounded bg-black/50 text-white backdrop-blur-sm z-10">
              AI
            </div>
          )}
        </div>

        <div ref={modalContentRef} className="w-full md:w-[404px] md:min-w-[404px] flex-1 flex flex-col max-h-[54dvh] md:max-h-full overflow-y-hidden bg-white">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[#efefef] shrink-0">
            <button onClick={handleViewUser} className="shrink-0">
              {post.avatarUrl ? (
                <img src={post.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-alu-surface flex items-center justify-center text-sm font-semibold text-alu-text-secondary">
                  {(post.displayName || 'U')[0].toUpperCase()}
                </div>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <button onClick={handleViewUser} className="hover:underline">
                <span className="font-semibold text-sm text-[#262626]">{post.displayName || 'Alu User'}</span>
              </button>
              <span className="text-xs text-[#8e8e8e] block">{timeAgo(post.timestamp)}</span>
            </div>
            {isOwner && (
              <button
                onClick={() => setShowOwnerOptions(true)}
                className="text-alu-text-tertiary hover:text-[#262626] transition-colors p-1"
                title="Post options"
              >
                <MoreVertIcon size={20} />
              </button>
            )}
          </div>

          <div ref={commentsSectionRef} className="flex-1 overflow-y-auto px-4 py-3">
            {post.safePrompt && post.safePrompt !== 'User upload' && (
              <div className="flex gap-2.5 mb-4">
                {post.avatarUrl ? (
                  <img src={post.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary shrink-0">
                    {(post.displayName || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <span className="font-semibold text-xs text-[#262626]">{post.displayName || 'User'}</span>
                  <p className="text-sm text-[#262626] mt-0.5">{post.safePrompt}</p>
                </div>
              </div>
            )}

            {loadingComments ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-center text-xs text-[#8e8e8e] py-6">No comments yet. Be the first!</p>
            ) : (
              <div className="flex flex-col gap-4">
                {comments.map(c => renderComment(c))}
              </div>
            )}
            <div ref={commentsEndRef} />
          </div>

          <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 border-t border-[#efefef] shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleLike}
                className={`transition-colors ${likedByMe ? 'text-[#ed4956]' : 'text-[#262626] hover:text-black/60'}`}
              >
                <HeartIcon size={24} />
              </button>
              <button
                onClick={() => {
                  commentInputRef.current?.focus();
                }}
                className="text-[#262626] hover:text-black/60 transition-colors"
              >
                <CommentIcon size={24} />
              </button>
              <button
                onClick={handleShare}
                className="text-[#262626] hover:text-black/60 transition-colors"
              >
                <ShareIcon size={23} />
              </button>
            </div>
            <button
              onClick={toggleSave}
              className={`transition-colors ${saved ? 'text-[#262626]' : 'text-[#262626] hover:text-black/60'}`}
            >
              <BookmarkIcon size={23} />
            </button>
          </div>

          <div className="px-4 pb-2.5">
            <p className="text-[13px] font-semibold text-[#262626]">{likeCount.toLocaleString()} likes</p>
            <p className="text-[11px] text-[#8e8e8e] mt-0.5 uppercase tracking-[0.2px]">{new Date(post.timestamp).toLocaleDateString()}</p>
          </div>

          <div className="border-t border-[#efefef] px-4 py-2.5 shrink-0">
            {replyingTo && (
              <div className="flex items-center justify-between mb-2 px-3 py-2 bg-[#fafafa] rounded-lg border border-[#efefef]">
                <span className="text-xs text-[#737373]">
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
                <img src={imagePreview} alt="Preview" className="max-w-[80px] rounded-lg" />
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

            <div className="flex items-center gap-2">
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
                className="h-9 w-9 rounded-full bg-transparent flex items-center justify-center text-[#8e8e8e] hover:text-[#262626] transition-colors disabled:opacity-50 shrink-0"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              <input
                ref={commentInputRef}
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                placeholder="Add a comment..."
                className="flex-1 h-9 px-0 bg-transparent text-sm text-[#262626] placeholder:text-[#8e8e8e] outline-none"
              />
              <button
                onClick={submitComment}
                disabled={submittingComment || uploadingImage || (!commentText.trim() && !imageFile)}
                className="h-9 px-1 text-sm font-semibold text-[#0095f6] disabled:opacity-40 transition-opacity"
              >
                {uploadingImage ? '...' : submittingComment ? '...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-[320px] mx-4 text-center" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-alu-text mb-2">Delete this post?</h3>
            <p className="text-sm text-alu-text-secondary mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deletePost}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOwnerOptions && (
        <div className="fixed inset-0 z-[210] bg-black/60 flex items-end md:items-center md:justify-center" onClick={() => setShowOwnerOptions(false)}>
          <div className="bg-white w-full md:w-[360px] rounded-t-2xl md:rounded-2xl p-3 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pb-2 md:hidden">
              <div className="w-10 h-1 bg-[#e5e5e5] rounded-full" />
            </div>
            <button
              onClick={async () => {
                await copyPostLink();
                setShowOwnerOptions(false);
              }}
              className="w-full px-4 py-3 text-sm font-medium text-[#262626] hover:bg-[#fafafa] rounded-xl text-left"
            >
              Copy link
            </button>
            <button
              onClick={() => {
                setShowOwnerOptions(false);
                setShowDeleteConfirm(true);
              }}
              className="w-full px-4 py-3 text-sm font-semibold text-[#ed4956] hover:bg-[#fff5f5] rounded-xl text-left"
            >
              Delete
            </button>
            <button
              onClick={() => setShowOwnerOptions(false)}
              className="w-full px-4 py-3 mt-1 text-sm font-medium text-[#262626] hover:bg-[#fafafa] rounded-xl text-left"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>
      </div>
  );

  return createPortal(modal, document.body);
}
