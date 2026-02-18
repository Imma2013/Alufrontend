'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { getWatchShareUrl } from '@/app/lib/publicUrl';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, useUser } from '@/app/lib/auth';
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
  likes: number;
  likedBy: string[];
  imageUrl?: string;
  replyCount?: number;
  replies?: CommentData[];
}

interface VideoQualityOption {
  id: string;
  label: string;
  src: string;
}

const buildQualityOptions = (url: string): VideoQualityOption[] => {
  if (!url || !url.startsWith('http')) return [{ id: '720p', label: '720p', src: url }];

  const uploadToken = '/video/upload/';
  const uploadIdx = url.indexOf(uploadToken);
  if (uploadIdx === -1 || !url.includes('res.cloudinary.com')) {
    return [{ id: '720p', label: '720p', src: url }];
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
  const [selectedQuality, setSelectedQuality] = useState<string>('720p');
  const [videoSrc, setVideoSrc] = useState('');

  const [activeReplyCommentId, setActiveReplyCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReplyFor, setSubmittingReplyFor] = useState<string | null>(null);

  const [commentImageFile, setCommentImageFile] = useState<File | null>(null);
  const [commentImagePreview, setCommentImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const resumeAfterSwitchRef = useRef(false);

  const backendUrl = BACKEND_URL;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${backendUrl}/posts/${postId}`);
        if (!res.ok) throw new Error('Post not found');
        const data = await res.json();
        setPost(data.post);
        setLikeCount(data.post.likes || 0);
        setLiked(data.post.likedBy?.includes(user?.id || '') || false);

        const commentsRes = await fetch(`${backendUrl}/posts/${postId}/comments`);
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          setComments(commentsData.comments || []);
        }

        try {
          const token = await getToken();
          const syncRes = await fetch(`${backendUrl}/sync/pull`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            const videos = (syncData.changes || [])
              .filter((p: PostData) => p.mediaType === 'video' && p.videoType === 'long' && p._id !== postId)
              .slice(0, 10);
            setRelatedPosts(videos);
          }
        } catch {
          setRelatedPosts([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };

    if (postId) {
      void fetchData();
    }
  }, [postId, backendUrl, user?.id, getToken]);

  useEffect(() => {
    if (!post?.contentUrl) return;
    const options = buildQualityOptions(post.contentUrl);
    setQualityOptions(options);
    const defaultOption = options.find((o) => o.id === '720p') || options[0];
    setSelectedQuality(defaultOption?.id || '720p');
    setVideoSrc(defaultOption?.src || post.contentUrl);
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

  useEffect(() => {
    return () => {
      if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
    };
  }, [commentImagePreview]);

  const uploadCommentImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'alu_comments');

    const res = await fetch('https://api.cloudinary.com/v1_1/dqfvkvggd/image/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error('Image upload failed');
    const data = await res.json();
    return data.secure_url as string;
  };

  const handleLikePost = async () => {
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${backendUrl}/posts/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
    });
    if (res.ok) {
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount(data.likes);
    }
  };

  const handleSubmitComment = async () => {
    if ((!commentText.trim() && !commentImageFile) || submitting) return;
    const token = await getToken();
    if (!token) return;

    setSubmitting(true);
    try {
      let imageUrl = '';
      if (commentImageFile) {
        setUploadingImage(true);
        imageUrl = await uploadCommentImage(commentImageFile);
      }

      const res = await fetch(`${backendUrl}/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: commentText.trim() || 'image',
          displayName: user?.fullName || '',
          avatarUrl: user?.imageUrl || '',
          parentCommentId: null,
          imageUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setComments((prev) => [{ ...data.comment, replies: [], replyCount: 0 }, ...prev]);
        setCommentText('');
        setCommentImageFile(null);
        if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
        setCommentImagePreview(null);
      }
    } finally {
      setSubmitting(false);
      setUploadingImage(false);
    }
  };

  const handleReplySubmit = async (parentCommentId: string) => {
    if (!replyText.trim() || submittingReplyFor) return;
    const token = await getToken();
    if (!token) return;

    setSubmittingReplyFor(parentCommentId);
    try {
      const res = await fetch(`${backendUrl}/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: replyText.trim(),
          displayName: user?.fullName || '',
          avatarUrl: user?.imageUrl || '',
          parentCommentId,
          imageUrl: '',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setComments((prev) =>
          prev.map((c) =>
            c._id === parentCommentId
              ? {
                  ...c,
                  replies: [...(c.replies || []), data.comment],
                  replyCount: (c.replyCount || 0) + 1,
                }
              : c
          )
        );
        setReplyText('');
        setActiveReplyCommentId(null);
      }
    } finally {
      setSubmittingReplyFor(null);
    }
  };

  const handleLikeComment = async (commentId: string, isReply = false, parentId?: string) => {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${backendUrl}/posts/${postId}/comments/${commentId}/like`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        displayName: user?.fullName || '',
        avatarUrl: user?.imageUrl || '',
      }),
    });

    if (!res.ok) return;
    const { liked: commentLiked, likes } = await res.json();
    const userId = user?.id || '';

    if (isReply && parentId) {
      setComments((prev) =>
        prev.map((c) =>
          c._id === parentId
            ? {
                ...c,
                replies: (c.replies || []).map((r) =>
                  r._id === commentId
                    ? {
                        ...r,
                        likes,
                        likedBy: commentLiked
                          ? [...(r.likedBy || []), userId]
                          : (r.likedBy || []).filter((id) => id !== userId),
                      }
                    : r
                ),
              }
            : c
        )
      );
      return;
    }

    setComments((prev) =>
      prev.map((c) =>
        c._id === commentId
          ? {
              ...c,
              likes,
              likedBy: commentLiked
                ? [...(c.likedBy || []), userId]
                : (c.likedBy || []).filter((id) => id !== userId),
            }
          : c
      )
    );
  };

  const handleDeleteComment = async (commentId: string, isReply = false, parentId?: string) => {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${backendUrl}/posts/${postId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return;

    if (isReply && parentId) {
      setComments((prev) =>
        prev.map((c) =>
          c._id === parentId
            ? {
                ...c,
                replies: (c.replies || []).filter((r) => r._id !== commentId),
                replyCount: Math.max(0, (c.replyCount || 0) - 1),
              }
            : c
        )
      );
      return;
    }

    setComments((prev) => prev.filter((c) => c._id !== commentId));
  };

  const handleShare = async () => {
    const url = getWatchShareUrl(postId);
    try {
      if (navigator.share) await navigator.share({ title: 'Check this out on Alu', url });
      else {
        await navigator.clipboard.writeText(url);
        alert('Link copied!');
      }
    } catch {
      // silent
    }
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

  const handleCommentImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
    const preview = URL.createObjectURL(file);
    setCommentImageFile(file);
    setCommentImagePreview(preview);
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

  const renderComment = (c: CommentData, isReply = false, parentId?: string) => {
    const isLiked = c.likedBy?.includes(user?.id || '') || false;
    const canDelete = c.userId === user?.id;

    return (
      <div key={c._id} className={isReply ? 'ml-10 mt-3' : ''}>
        <div className="flex gap-3 group">
          {c.avatarUrl ? (
            <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary shrink-0">
              {(c.displayName || 'U')[0].toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xs">
              <span className="font-semibold text-alu-text">{c.displayName || 'User'}</span>
              <span className="text-alu-text-tertiary ml-2">{timeAgo(c.createdAt)}</span>
            </p>
            <p className="text-sm text-alu-text mt-1 whitespace-pre-wrap">{c.text}</p>
            {c.imageUrl && <img src={c.imageUrl} alt="" className="mt-2 max-w-[220px] rounded-lg" />}

            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => handleLikeComment(c._id, isReply, parentId)}
                className={`text-xs font-semibold transition-colors ${
                  isLiked ? 'text-[#ed4956]' : 'text-alu-text-tertiary hover:text-alu-text'
                }`}
              >
                Like {c.likes > 0 ? `(${c.likes})` : ''}
              </button>

              <button
                onClick={() => {
                  const targetParentId = parentId || c._id;
                  if (activeReplyCommentId === targetParentId) {
                    setActiveReplyCommentId(null);
                    setReplyText('');
                  } else {
                    setActiveReplyCommentId(targetParentId);
                    setReplyText('');
                  }
                }}
                className="text-xs font-semibold text-alu-text-tertiary hover:text-alu-text transition-colors"
              >
                Reply
              </button>

              {canDelete && (
                <button
                  onClick={() => handleDeleteComment(c._id, isReply, parentId)}
                  className="text-xs font-semibold text-alu-text-tertiary hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>

        {!isReply && activeReplyCommentId === c._id && (
          <div className="ml-12 mt-2 flex items-center gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleReplySubmit(c._id)}
              placeholder={`Reply to ${c.displayName || 'User'}...`}
              className="flex-1 h-9 px-3 bg-alu-surface rounded-full text-xs text-alu-text placeholder:text-alu-text-tertiary outline-none focus:ring-2 focus:ring-[var(--alu-primary-glow)]"
            />
            <button
              onClick={() => void handleReplySubmit(c._id)}
              disabled={submittingReplyFor === c._id || !replyText.trim()}
              className="h-9 px-3 rounded-full text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
            >
              {submittingReplyFor === c._id ? '...' : 'Reply'}
            </button>
          </div>
        )}

        {!isReply && (c.replies || []).length > 0 && (
          <div className="mt-2">
            {(c.replies || []).map((reply) => renderComment(reply, true, c._id))}
          </div>
        )}
      </div>
    );
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
          <a href="/" className="text-sm text-[var(--alu-primary)] mt-2 inline-block hover:underline">
            &larr; Back to Alu
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--alu-bg)]">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)] h-14 flex items-center px-4 gap-3">
        <button onClick={() => router.push('/')} className="shrink-0 flex items-center gap-2 hover:opacity-80 transition-opacity">
          <AluLogo size={22} />
        </button>
        <div className="flex-1" />
        <a href="/" className="text-sm text-[var(--alu-primary)] font-medium hover:underline">
          &larr; Back to Feed
        </a>
      </header>

      <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-6 p-4 lg:p-6">
        <div className="flex-1 min-w-0">
          <div
            className="relative w-full bg-black rounded-xl overflow-hidden"
            style={{ aspectRatio: post.videoType === 'short' ? '9/16' : '16/9', maxHeight: '70vh' }}
          >
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
                    {qualityOptions.find((q) => q.id === selectedQuality)?.label || '720p'}
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

          <div className="mt-3">
            <h1 className="text-lg font-semibold text-alu-text leading-snug">{post.safePrompt || 'Untitled'}</h1>

            <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
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
                {post.is_ai && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--alu-primary-glow)] text-[var(--alu-primary)]">
                    AI Generated
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleLikePost}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    liked
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

            {post.safePrompt && post.safePrompt !== 'User upload' && (
              <div
                className="mt-3 p-3 bg-alu-surface rounded-xl cursor-pointer hover:bg-[var(--alu-hover)] transition-colors"
                onClick={() => setShowDescription(!showDescription)}
              >
                <p className={`text-sm text-alu-text ${showDescription ? '' : 'line-clamp-2'}`}>{post.safePrompt}</p>
                <span className="text-xs text-alu-text-tertiary mt-1 inline-block">
                  {showDescription ? 'Show less' : 'Show more'}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-base font-semibold text-alu-text mb-4">{comments.length} Comments</h3>

            <div className="flex gap-3 mb-6">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-alu-surface shrink-0" />
              )}

              <div className="flex-1">
                {commentImagePreview && (
                  <div className="mb-3 relative inline-block">
                    <img src={commentImagePreview} alt="Preview" className="max-w-[140px] rounded-lg" />
                    <button
                      onClick={() => {
                        setCommentImageFile(null);
                        if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
                        setCommentImagePreview(null);
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center text-white"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleCommentImageSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="h-9 w-9 rounded-full bg-alu-surface flex items-center justify-center text-alu-text-secondary hover:text-alu-text transition-colors shrink-0"
                    aria-label="Add image"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>

                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSubmitComment()}
                    placeholder="Add a comment..."
                    className="flex-1 h-10 px-0 border-b border-[var(--alu-border)] bg-transparent text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none focus:border-[var(--alu-primary)] transition-colors"
                  />
                </div>

                {(commentText.trim() || commentImageFile) && (
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => {
                        setCommentText('');
                        setCommentImageFile(null);
                        if (commentImagePreview) URL.revokeObjectURL(commentImagePreview);
                        setCommentImagePreview(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-alu-text-secondary hover:bg-alu-surface rounded-full"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleSubmitComment()}
                      disabled={submitting || uploadingImage}
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-full disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                    >
                      {uploadingImage ? 'Uploading...' : submitting ? 'Posting...' : 'Comment'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {comments.map((c) => renderComment(c))}
              {comments.length === 0 && (
                <p className="text-sm text-alu-text-tertiary text-center py-8">No comments yet. Be the first!</p>
              )}
            </div>
          </div>
        </div>

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
