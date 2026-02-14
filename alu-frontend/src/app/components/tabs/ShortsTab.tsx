'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth, useUser } from '@clerk/nextjs';
import { db, Post } from '../../db';
import MediaItem from '../MediaItem';
import CommentsDrawer from '../CommentsDrawer';
import { HeartIcon, CommentIcon, ShareIcon, BookmarkIcon, ShortsIcon } from '../icons';

interface ShortsTabProps {
  searchQuery?: string;
  onViewUser?: (userId: string) => void;
}

export default function ShortsTab({ searchQuery = '', onViewUser }: ShortsTabProps) {
  const MAX_CAPTION_CHARS = 95;
  const { getToken } = useAuth();
  const { user } = useUser();
  const [feedMode, setFeedMode] = useState<'for-you' | 'following'>('for-you');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(new Set());
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    setIsPaused(false);
    setShowComments(false);
  }, [currentIndex]);

  useEffect(() => {
    const fetchFollowing = async () => {
      try {
        if (!user?.id) return;
        const token = await getToken();
        const res = await fetch(`${backendUrl}/users/${user.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        setFollowingIds(new Set((data.following || []) as string[]));
      } catch {
        setFollowingIds(new Set());
      }
    };
    fetchFollowing();
  }, [user?.id, backendUrl, getToken]);

  const handleTapVideo = () => {
    const container = videoContainerRef.current;
    if (!container) return;
    const video = container.querySelector('video');
    if (video) {
      if (video.paused) {
        video.play();
        setIsPaused(false);
      } else {
        video.pause();
        setIsPaused(true);
      }
    }
  };

  const allShorts = useLiveQuery(
    async () => {
      const all = await db.posts.where('mediaType').equals('video').toArray();
      return all
        .filter((p: Post) => !p.videoType || p.videoType === 'short')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    []
  );

  const shorts =
    allShorts?.filter((p: Post) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return p.safePrompt?.toLowerCase().includes(q) || p.displayName?.toLowerCase().includes(q);
    }) || [];

  const shortsList = feedMode === 'following'
    ? shorts.filter((p) => !!p.userId && followingIds.has(p.userId))
    : shorts;
  const short = shortsList[currentIndex];

  useEffect(() => {
    setCurrentIndex(0);
  }, [feedMode, searchQuery]);

  useEffect(() => {
    if (currentIndex >= shortsList.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, shortsList.length]);

  const toggleLike = async () => {
    if (!short) return;
    const key = short._id;
    const token = await getToken();
    if (!token) return;

    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      await fetch(`${backendUrl}/posts/${key}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
      });
    } catch (err) {
      console.error('Like failed:', err);
    }
  };

  const toggleSave = async () => {
    if (!short) return;
    const key = short._id;
    const token = await getToken();
    if (!token) return;

    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      await fetch(`${backendUrl}/posts/${key}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const handleShare = async () => {
    if (!short) return;
    const shareUrl = `${window.location.origin}/post/${short._id}`;
    const shareData = {
      title: 'Check out this short on Alu',
      text: short.safePrompt || 'Shared from Alu',
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

  const toggleFollow = async (creatorUserId: string) => {
    if (!user?.id || creatorUserId === user.id) return;
    const token = await getToken();
    if (!token) return;
    const isFollowing = followingIds.has(creatorUserId);
    const endpoint = isFollowing ? 'unfollow' : 'follow';

    try {
      const res = await fetch(`${backendUrl}/users/${creatorUserId}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: user.fullName || '', avatarUrl: user.imageUrl || '' }),
      });
      if (!res.ok) return;
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (isFollowing) next.delete(creatorUserId);
        else next.add(creatorUserId);
        return next;
      });
    } catch (err) {
      console.error('Follow toggle failed:', err);
    }
  };

  const goNext = useCallback(() => {
    if (currentIndex < shortsList.length - 1) setCurrentIndex((prev) => prev + 1);
  }, [currentIndex, shortsList.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex((prev) => prev - 1);
  }, [currentIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    const canGoUp = currentIndex < shortsList.length - 1;
    const canGoDown = currentIndex > 0;
    if (deltaY < 0 && !canGoUp) {
      setSwipeOffset(deltaY * 0.2);
    } else if (deltaY > 0 && !canGoDown) {
      setSwipeOffset(deltaY * 0.2);
    } else {
      setSwipeOffset(deltaY * 0.5);
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    const elapsed = Date.now() - touchStartTime.current;
    const velocity = Math.abs(swipeOffset) / elapsed;

    if (swipeOffset < -50 || (swipeOffset < -20 && velocity > 0.3)) {
      goNext();
    } else if (swipeOffset > 50 || (swipeOffset > 20 && velocity > 0.3)) {
      goPrev();
    }
    setSwipeOffset(0);
  };

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > 30) goNext();
      else if (e.deltaY < -30) goPrev();
    },
    [goNext, goPrev]
  );

  if (shortsList.length === 0) {
    return (
      <div className="w-full h-full min-h-[70vh] flex items-center justify-center animate-fade-in bg-[#0a0a0a]">
        <div className="text-center py-16 px-5">
          <div className="flex items-center justify-center gap-4 text-white text-sm font-semibold mb-6">
            <button
              onClick={() => setFeedMode('following')}
              className={`${feedMode === 'following' ? 'opacity-100 border-b-2 border-white pb-0.5' : 'opacity-70 hover:opacity-90'}`}
            >
              Following
            </button>
            <button
              onClick={() => setFeedMode('for-you')}
              className={`${feedMode === 'for-you' ? 'opacity-100 border-b-2 border-white pb-0.5' : 'opacity-70 hover:opacity-90'}`}
            >
              For You
            </button>
          </div>
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 text-white/85">
            <ShortsIcon size={28} />
          </div>
          <p className="text-sm font-semibold text-white mb-1">
            {feedMode === 'following' ? 'No shorts from people you follow yet' : 'No reels yet'}
          </p>
          <p className="text-xs text-white/65">
            {feedMode === 'following' ? 'Switch to For You or follow more creators' : 'Post a short video to start this feed'}
          </p>
        </div>
      </div>
    );
  }

  if (!short) return null;

  const shortKey = short._id;
  const rawCaption = short.safePrompt && short.safePrompt !== 'User upload' ? short.safePrompt : '';
  const isCaptionLong = rawCaption.length > MAX_CAPTION_CHARS;
  const isCaptionExpanded = expandedCaptions.has(shortKey);
  const visibleCaption = isCaptionLong && !isCaptionExpanded ? `${rawCaption.slice(0, MAX_CAPTION_CHARS).trimEnd()}...` : rawCaption;
  const isFollowingCreator = !!short.userId && followingIds.has(short.userId);
  const isOwnShort = short.userId === user?.id;

  return (
    <div className="w-full h-full min-h-[70vh] flex items-center justify-center animate-fade-in bg-black select-none" onWheel={handleWheel}>
      <div className="relative flex items-center justify-center w-full h-full">
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 text-white text-sm font-semibold">
          <button
            onClick={() => setFeedMode('following')}
            className={`${feedMode === 'following' ? 'opacity-100 border-b-2 border-white pb-0.5' : 'opacity-70 hover:opacity-90'}`}
          >
            Following
          </button>
          <button
            onClick={() => setFeedMode('for-you')}
            className={`${feedMode === 'for-you' ? 'opacity-100 border-b-2 border-white pb-0.5' : 'opacity-70 hover:opacity-90'}`}
          >
            For You
          </button>
        </div>
        <div
          className={`relative w-full md:max-w-[430px] mx-auto overflow-hidden transition-all duration-300 ${
            !isMobile && showComments ? 'md:-translate-x-[180px]' : 'translate-x-0'
          }`}
          style={{
            height: isMobile ? 'calc(100vh - 120px)' : 'calc(100vh - 150px)',
            maxHeight: '780px',
            width: !isMobile && showComments ? '430px' : undefined,
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={`w-full h-full overflow-hidden relative bg-black ${isMobile ? '' : 'md:rounded-2xl'}`}
            style={{
              transform: `translateY(${swipeOffset}px)`,
              transition: isSwiping ? 'none' : 'transform 0.3s ease-out',
            }}
          >
            <div className="absolute inset-0" ref={videoContainerRef} onClick={handleTapVideo}>
              <div className="absolute inset-0 scale-110 opacity-55 blur-[18px]">
                <MediaItem post={short} videoControls={false} autoPlayVideo videoObjectFit="cover" />
              </div>
              <div className="absolute inset-0">
                <MediaItem post={short} videoControls={false} autoPlayVideo videoObjectFit="contain" />
              </div>
            </div>

            {isPaused && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <polygon points="8,5 19,12 8,19" />
                  </svg>
                </div>
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent pointer-events-none" />

            <div className="absolute bottom-0 left-0 right-16 p-4 pointer-events-none">
              <div className="flex items-center gap-2 mb-2 pointer-events-auto">
                {short.avatarUrl ? (
                  <button onClick={() => short.userId && onViewUser?.(short.userId)}>
                    <img src={short.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-white/60" />
                  </button>
                ) : (
                  <button
                    onClick={() => short.userId && onViewUser?.(short.userId)}
                    className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-xs font-bold border border-white/60"
                  >
                    {(short.displayName || short.userId || 'U')[0].toUpperCase()}
                  </button>
                )}
                <button
                  onClick={() => short.userId && onViewUser?.(short.userId)}
                  className="text-white font-semibold text-sm"
                >
                  {short.displayName || 'Alu User'}
                </button>
                {!isOwnShort && short.userId && (
                  <button
                    onClick={() => toggleFollow(short.userId!)}
                    className="text-white text-sm font-semibold"
                  >
                    {isFollowingCreator ? 'Following' : 'Follow'}
                  </button>
                )}
              </div>

              {rawCaption && (
                <p className="text-white text-[13px] leading-snug pointer-events-auto">
                  {visibleCaption}{' '}
                  {isCaptionLong && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCaptions((prev) => {
                          const next = new Set(prev);
                          if (next.has(shortKey)) next.delete(shortKey);
                          else next.add(shortKey);
                          return next;
                        });
                      }}
                      className="font-semibold text-white/85 hover:text-white transition-colors"
                    >
                      {isCaptionExpanded ? 'less' : 'more'}
                    </button>
                  )}
                </p>
              )}

            </div>

            <div className="absolute bottom-20 right-3 flex flex-col items-center gap-5">
              <button
                className="relative"
                onClick={(e) => {
                  e.stopPropagation();
                  if (short.userId) onViewUser?.(short.userId);
                }}
                aria-label="Creator profile"
              >
                {short.avatarUrl ? (
                  <img src={short.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white/90" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/90 flex items-center justify-center text-white text-xs font-bold">
                    {(short.displayName || short.userId || 'U')[0].toUpperCase()}
                  </div>
                )}
              </button>

              <button onClick={(e) => { e.stopPropagation(); toggleLike(); }} className="flex flex-col items-center gap-1">
                <div className={`w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center transition-colors ${liked.has(shortKey) ? 'text-red-400' : 'text-white'}`}>
                  <HeartIcon size={24} />
                </div>
                <span className="text-white text-[11px] font-medium">{(short.likes || 0) + (liked.has(shortKey) ? 1 : 0)}</span>
              </button>

              <button onClick={(e) => { e.stopPropagation(); setShowComments(!showComments); }} className="flex flex-col items-center gap-1">
                <div className={`w-11 h-11 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                  showComments ? 'bg-white text-black' : 'bg-white/15 text-white'
                }`}>
                  <CommentIcon size={24} />
                </div>
                {(short.commentsCount ?? 0) > 0 && <span className="text-white text-[11px] font-medium">{short.commentsCount}</span>}
              </button>

              <button onClick={(e) => { e.stopPropagation(); toggleSave(); }} className="flex flex-col items-center gap-1">
                <div className={`w-11 h-11 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                  saved.has(shortKey) ? 'bg-white text-black' : 'bg-white/15 text-white'
                }`}>
                  <BookmarkIcon size={24} />
                </div>
              </button>

              <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="flex flex-col items-center gap-1">
                <div className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white">
                  <ShareIcon size={23} />
                </div>
              </button>
            </div>

            {currentIndex < shortsList.length - 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-bounce">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.55">
                  <polyline points="6,9 12,15 18,9" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      <CommentsDrawer
        postId={short?._id || ''}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        variant={isMobile ? 'mobile' : 'desktop'}
        disableBackdropBlur
        postOwnerId={short?.userId}
      />
    </div>
  );
}
