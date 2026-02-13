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
}

export default function ShortsTab({ searchQuery = '' }: ShortsTabProps) {
  const MAX_CAPTION_CHARS = 95;
  const { getToken } = useAuth();
  const { user } = useUser();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(new Set());
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Reset pause state and close comments when switching shorts
  useEffect(() => {
    setIsPaused(false);
    setShowComments(false);
  }, [currentIndex]);

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

  // Real data from Dexie — shorts
  const allShorts = useLiveQuery(
    async () => {
      const all = await db.posts.where('mediaType').equals('video').toArray();
      return all
        .filter((p: Post) => !p.videoType || p.videoType === 'short')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    []
  );

  // Filter by search query
  const shorts = allShorts?.filter((p: Post) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return p.safePrompt?.toLowerCase().includes(q) || p.displayName?.toLowerCase().includes(q);
  }) || [];

  const shortsList = shorts;
  const short = shortsList[currentIndex];

  const toggleLike = async () => {
    if (!short) return;
    const key = short._id;
    const token = await getToken();
    if (!token) return;

    // Optimistic update
    setLiked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    // API call
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      await fetch(`${backendUrl}/posts/${key}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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

    // Optimistic update
    setSaved(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    // API call
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      await fetch(`${backendUrl}/posts/${key}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
      try { await navigator.clipboard.writeText(shareUrl); } catch { /* silent */ }
    }
  };

  const goNext = useCallback(() => {
    if (currentIndex < shortsList.length - 1) setCurrentIndex(prev => prev + 1);
  }, [currentIndex, shortsList.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  }, [currentIndex]);

  // Touch handlers for vertical swipe (TikTok style)
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY > 30) goNext();
    else if (e.deltaY < -30) goPrev();
  }, [goNext, goPrev]);

  // Empty state
  if (shortsList.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center animate-fade-in">
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-alu-surface flex items-center justify-center mx-auto mb-4 text-alu-text-tertiary">
            <ShortsIcon size={28} />
          </div>
          <p className="text-sm font-semibold text-alu-text mb-1">No shorts yet</p>
          <p className="text-xs text-alu-text-tertiary">Be the first to post one</p>
        </div>
      </div>
    );
  }

  if (!short) return null;

  const shortKey = short._id;
  const rawCaption = short.safePrompt && short.safePrompt !== 'User upload' ? short.safePrompt : '';
  const isCaptionLong = rawCaption.length > MAX_CAPTION_CHARS;
  const isCaptionExpanded = expandedCaptions.has(shortKey);
  const visibleCaption = isCaptionLong && !isCaptionExpanded
    ? `${rawCaption.slice(0, MAX_CAPTION_CHARS).trimEnd()}...`
    : rawCaption;

  return (
    <div
      className="w-full h-full flex items-center justify-center animate-fade-in select-none"
      onWheel={handleWheel}
    >
      {/* Desktop: Flex layout for video + comments side-by-side */}
      <div className="relative flex items-center justify-center w-full h-full">
        {/* Video container - shifts left on desktop when comments open */}
        <div
          className={`relative w-full max-w-[400px] mx-auto overflow-hidden transition-all duration-300 ${
            !isMobile && showComments ? 'md:-translate-x-[200px]' : 'translate-x-0'
          }`}
          style={{
            height: 'calc(100vh - 180px)',
            maxHeight: '720px',
            width: !isMobile && showComments ? '520px' : '400px'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
        {/* Video area — slides vertically */}
        <div
          className="w-full h-full rounded-2xl overflow-hidden relative bg-black"
          style={{
            transform: `translateY(${swipeOffset}px)`,
            transition: isSwiping ? 'none' : 'transform 0.3s ease-out',
          }}
        >
          {/* Media content — tap to pause/play */}
          <div className="absolute inset-0" ref={videoContainerRef} onClick={handleTapVideo}>
            <MediaItem post={short} videoControls={false} autoPlayVideo />
          </div>

          {/* Pause indicator */}
          {isPaused && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
              </div>
            </div>
          )}

          {/* Bottom gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-16 p-4 pointer-events-none">
            <div className="flex items-center gap-2 mb-2">
              {short.avatarUrl ? (
                <img src={short.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-xs font-bold">
                  {(short.displayName || short.userId || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="text-white font-semibold text-sm">{short.displayName || 'Alu User'}</span>
            </div>
            {rawCaption && (
              <p className="text-white text-sm leading-snug pointer-events-auto">
                {visibleCaption}{' '}
                {isCaptionLong && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedCaptions(prev => {
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
            {short.is_ai && (
              <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-white/20 text-white backdrop-blur-sm">AI</span>
            )}
          </div>

          {/* Right side actions (TikTok style) */}
          <div className="absolute bottom-20 right-3 flex flex-col items-center gap-5">
            <button className="relative" onClick={(e) => e.stopPropagation()} aria-label="Creator profile">
              {short.avatarUrl ? (
                <img src={short.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white/85" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/85 flex items-center justify-center text-white text-xs font-bold">
                  {(short.displayName || short.userId || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-[var(--alu-primary)] text-white text-xs leading-5 text-center font-bold">
                +
              </span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); toggleLike(); }} className="flex flex-col items-center gap-1">
              <div className={`w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center transition-colors ${liked.has(shortKey) ? 'text-red-400' : 'text-white'}`}>
                <HeartIcon size={22} />
              </div>
              <span className="text-white text-[11px] font-medium">{(short.likes || 0) + (liked.has(shortKey) ? 1 : 0)}</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowComments(!showComments); }} className="flex flex-col items-center gap-1">
              <div className={`w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                showComments ? 'bg-[var(--alu-primary)] text-white' : 'bg-white/15 text-white'
              }`}>
                <CommentIcon size={22} />
              </div>
              {(short.commentsCount ?? 0) > 0 && (
                <span className="text-white text-[11px] font-medium">{short.commentsCount}</span>
              )}
            </button>
            <button onClick={(e) => { e.stopPropagation(); toggleSave(); }} className="flex flex-col items-center gap-1">
              <div className={`w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                saved.has(shortKey) ? 'bg-[var(--alu-primary)] text-white' : 'bg-white/15 text-white'
              }`}>
                <BookmarkIcon size={22} />
              </div>
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white">
                <ShareIcon size={22} />
              </div>
            </button>
          </div>

          {/* Swipe hint */}
          {currentIndex < shortsList.length - 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-bounce">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.5">
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Comments drawer */}
      <CommentsDrawer
        postId={short?._id || ''}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        variant={isMobile ? 'mobile' : 'desktop'}
      />
    </div>
  );
}
