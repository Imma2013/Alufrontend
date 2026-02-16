'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { getPostShareUrl } from '@/app/lib/publicUrl';

import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth, useUser } from '@clerk/nextjs';
import { db, Post } from '../../db';
import { pullChanges, pushChanges } from '../../syncService';
import MediaItem from '../MediaItem';
import MentionText from '../MentionText';
import { HeartIcon, CommentIcon, ShareIcon, BookmarkIcon } from '../icons';
import PostModal from '../PostModal';
import ImageCarousel from '../ImageCarousel';

interface UserResult {
  userId: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
}

interface HomeTabProps {
  showAI: boolean;
  showNormal: boolean;
  searchQuery?: string;
  onViewUser?: (userId: string) => void;
}

export default function HomeTab({ showAI, showNormal, searchQuery = '', onViewUser }: HomeTabProps) {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const [feedMode, setFeedMode] = useState<'for-you' | 'following'>('for-you');
  const [followingUserIds, setFollowingUserIds] = useState<Set<string>>(new Set());
  const [likedPosts, setLikedPosts] = useState<Record<string, number>>({});
  const [likedByMe, setLikedByMe] = useState<Set<string>>(new Set());
  const [savedPosts, setSavedPosts] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [openCommentsOnModal, setOpenCommentsOnModal] = useState(false);
  const [peopleResults, setPeopleResults] = useState<UserResult[]>([]);
  const [isSearchingPeople, setIsSearchingPeople] = useState(false);
  const [feedActionError, setFeedActionError] = useState('');
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizeAvatarUrl = (raw?: string) => {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
    }
    return '';
  };

  const allPosts = useLiveQuery(
    () => db.posts.orderBy('timestamp').reverse().toArray(),
    []
  );
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setPeopleResults([]);
      setIsSearchingPeople(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearchingPeople(true);
      try {
        const token = await getToken();
        const backendUrl = BACKEND_URL;
        const res = await fetch(
          `${backendUrl}/users/search?q=${encodeURIComponent(searchQuery.trim())}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (res.ok) {
          const data = await res.json();
          setPeopleResults(data.users || []);
        }
      } catch (err) {
        console.error('People search failed:', err);
      } finally {
        setIsSearchingPeople(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, getToken]);

  const posts =
    allPosts?.filter((p: Post) => {
      if (feedMode === 'following') {
        const isMine = p.userId === user?.id;
        const isFollowing = !!p.userId && followingUserIds.has(p.userId);
        if (!isMine && !isFollowing) return false;
      }

      if (showAI && !showNormal) {
        if (!p.is_ai) return false;
      } else if (!showAI && showNormal) {
        if (p.is_ai) return false;
      } else if (!showAI && !showNormal) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchPrompt = p.safePrompt?.toLowerCase().includes(q);
        const matchName = p.displayName?.toLowerCase().includes(q);
        if (!matchPrompt && !matchName) return false;
      }

      return true;
    }) || [];

  const isSearching = !!searchQuery.trim();

  useEffect(() => {
    if (!allPosts || !user) return;
    const myLikes = new Set<string>();
    const mySaves = new Set<string>();
    const counts: Record<string, number> = {};
    for (const post of allPosts) {
      if (post.likedBy?.includes(user.id)) {
        myLikes.add(post._id);
      }
      if (post.savedBy?.includes(user.id)) {
        mySaves.add(post._id);
      }
      counts[post._id] = post.likes ?? 0;
    }
    setLikedByMe(myLikes);
    setSavedPosts(mySaves);
    setLikedPosts(counts);
  }, [allPosts, user]);

  useEffect(() => {
    const refreshFollowing = async () => {
      if (!user?.id) {
        setFollowingUserIds(new Set());
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/users/${user.id}`);
        if (!res.ok) {
          setFollowingUserIds(new Set());
          return;
        }
        const data = await res.json();
        const list = Array.isArray(data.following) ? data.following : [];
        setFollowingUserIds(new Set(list));
      } catch {
        setFollowingUserIds(new Set());
      }
    };

    refreshFollowing();
  }, [user?.id]);

  useEffect(() => {
    const runSync = async () => {
      setIsSyncing(true);
      await pullChanges();
      if (isSignedIn) {
        const token = await getToken();
        if (token) await pushChanges(token);
      }
      setIsSyncing(false);
    };

    runSync();
    const interval = setInterval(runSync, 60000);
    return () => clearInterval(interval);
  }, [isSignedIn, getToken]);

  const resolveMentionAndView = async (handle: string) => {
    if (!handle || !onViewUser) return;
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND_URL}/users/search?q=${encodeURIComponent(handle)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      const users: UserResult[] = Array.isArray(data.users) ? data.users : [];
      const exact = users.find((u) => (u.displayName || '').toLowerCase() === handle.toLowerCase());
      const target = exact || users[0];
      if (target?.userId) onViewUser(target.userId);
    } catch {
    }
  };

  const getPostKey = (post: Post) => post._id;

  const toggleLike = async (postId: string) => {
    const token = await getToken();
    if (!token) {
      setFeedActionError('Sign in to like posts.');
      return;
    }
    const backendUrl = BACKEND_URL;
    try {
      setFeedActionError('');
      const res = await fetch(`${backendUrl}/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
      });
      if (res.status === 404) {
        try { await db.posts.delete(postId); } catch { /* ok */ }
        await pullChanges();
        setFeedActionError('This post is no longer available. Feed refreshed.');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setLikedPosts((prev) => ({ ...prev, [postId]: data.likes }));
        setLikedByMe((prev) => {
          const next = new Set(prev);
          if (data.liked) {
            next.add(postId);
          } else {
            next.delete(postId);
          }
          return next;
        });
        const current = await db.posts.get(postId);
        if (current) {
          const nextLikedBy = data.liked
            ? Array.from(new Set([...(current.likedBy || []), user?.id || ''].filter(Boolean)))
            : (current.likedBy || []).filter((id) => id !== (user?.id || ''));
          await db.posts.update(postId, { likes: Number(data.likes || 0), likedBy: nextLikedBy });
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedActionError(data?.error || 'Could not like this post right now.');
      }
    } catch (err) {
      console.error('Like failed:', err);
      setFeedActionError('Could not like this post right now.');
    }
  };

  const toggleSave = async (postId: string) => {
    try {
      setFeedActionError('');
      const token = await getToken();
      if (!token || !user) {
        setFeedActionError('Sign in to save posts.');
        return;
      }

      const backendUrl = BACKEND_URL;
      const res = await fetch(`${backendUrl}/posts/${postId}/favorite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();

        setSavedPosts((prev) => {
          const next = new Set(prev);
          if (data.saved) {
            next.add(postId);
          } else {
            next.delete(postId);
          }
          return next;
        });

        await db.posts.update(postId, {
          savedBy: data.saved
            ? [...((await db.posts.get(postId))?.savedBy || []), user.id]
            : ((await db.posts.get(postId))?.savedBy || []).filter((id) => id !== user.id),
        });
      } else if (res.status === 404) {
        try { await db.posts.delete(postId); } catch { /* ok */ }
        await pullChanges();
        setFeedActionError('This post is no longer available. Feed refreshed.');
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedActionError(data?.error || 'Could not save this post right now.');
      }
    } catch (err) {
      console.error('Save failed:', err);
      setFeedActionError('Could not save this post right now.');
    }
  };

  const handleShare = async (post: Post) => {
    const shareUrl = getPostShareUrl(post._id);
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
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
      }
    }
  };

  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return count.toString();
  };

  const timeAgo = (date: Date) => {
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

  const openPostModal = (post: Post, openComments = false) => {
    setSelectedPost(post);
    setOpenCommentsOnModal(openComments);
  };

  const openComments = (post: Post) => {
    openPostModal(post, true);
  };

  return (
    <div className="w-full max-w-full md:max-w-[470px] mx-auto animate-fade-in bg-white">
      {isSyncing && (
        <div className="text-center py-2">
          <span className="text-[11px] text-alu-text-tertiary animate-pulse">Syncing...</span>
        </div>
      )}
      {feedActionError && (
        <div className="px-4 py-2 text-xs text-red-500 border-b border-alu-border bg-white">{feedActionError}</div>
      )}

      <div className="px-3 py-2 border-b border-alu-border bg-white flex items-center gap-4">
        <button
          type="button"
          onClick={() => setFeedMode('for-you')}
          className={`text-sm font-semibold transition-colors ${feedMode === 'for-you' ? 'text-alu-text' : 'text-alu-text-tertiary hover:text-alu-text-secondary'}`}
        >
          For You
        </button>
        <button
          type="button"
          onClick={() => setFeedMode('following')}
          className={`text-sm font-semibold transition-colors ${feedMode === 'following' ? 'text-alu-text' : 'text-alu-text-tertiary hover:text-alu-text-secondary'}`}
        >
          Following
        </button>
      </div>

      {isSearching && (
        <div className="px-4 py-3 border-b border-alu-border bg-white">
          <h3 className="text-xs font-bold text-alu-text-tertiary uppercase tracking-wider mb-2">People</h3>
          {isSearchingPeople ? (
            <div className="flex items-center gap-2 py-2">
              <div className="w-5 h-5 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-alu-text-tertiary">Searching...</span>
            </div>
          ) : peopleResults.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
              {peopleResults.map((u) => (
                <button
                  key={u.userId}
                  onClick={() => onViewUser?.(u.userId)}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-alu-bg-secondary hover:bg-[var(--alu-hover)] transition-colors w-[100px]"
                >
                  {normalizeAvatarUrl(u.avatarUrl) && !brokenAvatars[`people:${u.userId}`] ? (
                    <img
                      src={normalizeAvatarUrl(u.avatarUrl)}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover"
                      onError={() => setBrokenAvatars((prev) => ({ ...prev, [`people:${u.userId}`]: true }))}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[var(--alu-primary-glow)] flex items-center justify-center text-sm font-bold text-[var(--alu-primary)]">
                      {(u.displayName || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-alu-text truncate w-full text-center">{u.displayName || 'User'}</span>
                  {u.bio && <span className="text-[10px] text-alu-text-tertiary truncate w-full text-center">{u.bio}</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-alu-text-tertiary py-1">No people found</p>
          )}
          <div className="h-[1px] bg-alu-border mt-2" />
          {posts.length > 0 && (
            <h3 className="text-xs font-bold text-alu-text-tertiary uppercase tracking-wider mt-3 mb-1">Posts</h3>
          )}
        </div>
      )}

      <div className="flex flex-col md:py-2">
        {!allPosts && (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-alu-text-tertiary">Loading feed...</p>
          </div>
        )}

        {allPosts && posts.length === 0 && (
          <div className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-alu-surface flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--alu-text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-alu-text mb-1">
              {feedMode === 'following' ? 'No posts from people you follow yet' : 'No posts yet'}
            </p>
            <p className="text-xs text-alu-text-tertiary">
              {feedMode === 'following' ? 'Follow creators to build your feed' : 'Be the first to create something'}
            </p>
          </div>
        )}

        {posts.map((post) => {
          const key = getPostKey(post);
          if (!key) return null;
          const isShortVideo = post.mediaType === 'video' && (!post.videoType || post.videoType === 'short');
          return (
            <article
              key={key}
              className="border-b border-alu-border bg-white"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => post.userId && onViewUser?.(post.userId)} className="shrink-0">
                  {normalizeAvatarUrl(post.avatarUrl) && !brokenAvatars[`post:${post._id}`] ? (
                    <img
                      src={normalizeAvatarUrl(post.avatarUrl)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover"
                      onError={() => setBrokenAvatars((prev) => ({ ...prev, [`post:${post._id}`]: true }))}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-alu-surface flex items-center justify-center text-sm font-semibold text-alu-text-secondary">
                      {(post.displayName || post.userId || 'U')[0].toUpperCase()}
                    </div>
                  )}
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <button onClick={() => post.userId && onViewUser?.(post.userId)} className="hover:underline">
                    <span className="font-semibold text-[13px] text-alu-text">{post.displayName || 'Alu User'}</span>
                  </button>
                  <span className="text-[11px] text-alu-text-tertiary">{timeAgo(post.timestamp)}</span>
                </div>
              </div>

              <div
                className={`w-full relative overflow-hidden cursor-pointer ${isShortVideo ? 'aspect-[9/16] bg-black' : 'aspect-square bg-alu-surface'}`}
                onClick={() => openPostModal(post)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPostModal(post);
                  }
                }}
              >
                {post.mediaType === 'image' && post.images && post.images.length > 1 ? (
                  <ImageCarousel images={post.images} />
                ) : (
                  <MediaItem post={post} videoObjectFit={isShortVideo ? 'contain' : 'cover'} />
                )}
                {post.is_ai && (
                  <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded bg-black/45 text-white backdrop-blur-sm">
                    AI
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-3.5">
                  <button
                    onClick={() => toggleLike(post._id)}
                    className={`transition-all duration-200 ${
                      likedByMe.has(post._id) ? 'text-[var(--alu-danger)]' : 'text-alu-text-secondary hover:text-alu-text'
                    }`}
                    aria-label="Like post"
                  >
                    <HeartIcon size={23} />
                  </button>
                  <button
                    onClick={() => openComments(post)}
                    className="text-alu-text-secondary hover:text-alu-text transition-colors"
                    aria-label="Open comments"
                  >
                    <CommentIcon size={23} />
                  </button>
                  <button
                    onClick={() => handleShare(post)}
                    className="text-alu-text-secondary hover:text-alu-text transition-colors"
                    aria-label="Share post"
                  >
                    <ShareIcon size={22} />
                  </button>
                </div>
                <button onClick={() => toggleSave(key)} className={`transition-all duration-200 ${savedPosts.has(key) ? 'text-alu-text' : 'text-alu-text-secondary hover:text-alu-text'}`}>
                  <BookmarkIcon size={22} />
                </button>
              </div>

              <div className="px-4 pb-3 space-y-1.5">
                <p className="text-[13px] font-semibold text-alu-text">
                  {formatCount(likedPosts[post._id] ?? post.likes ?? 0)} likes
                </p>

                {post.commentsCount && post.commentsCount > 0 ? (
                  <button
                    onClick={() => openComments(post)}
                    className="text-[13px] text-alu-text-secondary hover:text-alu-text transition-colors"
                  >
                    View all {formatCount(post.commentsCount)} comments
                  </button>
                ) : (
                  <button
                    onClick={() => openComments(post)}
                    className="text-[13px] text-alu-text-secondary hover:text-alu-text transition-colors"
                  >
                    Add a comment...
                  </button>
                )}

                {post.safePrompt && post.safePrompt !== 'User upload' && (
                  <p className="text-[13px] leading-relaxed text-alu-text">
                    <button
                      onClick={() => post.userId && onViewUser?.(post.userId)}
                      className="font-semibold mr-1 hover:underline"
                    >
                      {post.displayName || 'Alu User'}
                    </button>
                    <MentionText text={post.safePrompt} onMentionClick={resolveMentionAndView} />
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => {
            setSelectedPost(null);
            setOpenCommentsOnModal(false);
          }}
          onViewUser={onViewUser}
          openComments={openCommentsOnModal}
        />
      )}
    </div>
  );
}

