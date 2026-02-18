'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Story, db } from '../db';
import { useAuth } from '@/app/lib/auth';

interface StoryGroup {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  stories: Story[];
}

interface StoryViewerModalProps {
  isOpen: boolean;
  groups: StoryGroup[];
  initialUserId: string;
  currentUserId?: string;
  currentUserName?: string;
  currentUserAvatar?: string;
  onClose: () => void;
}

export default function StoryViewerModal({
  isOpen,
  groups,
  initialUserId,
  currentUserId,
  currentUserName = 'User',
  currentUserAvatar = '',
  onClose,
}: StoryViewerModalProps) {
  const { getToken } = useAuth();
  const [mounted, setMounted] = useState(false);
  const initialGroupIndex = Math.max(0, groups.findIndex((group) => group.userId === initialUserId));
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setGroupIndex(Math.max(0, groups.findIndex((group) => group.userId === initialUserId)));
    setStoryIndex(0);
    setProgress(0);
  }, [isOpen, groups, initialUserId]);

  const activeGroup = groups[groupIndex];
  const activeStory = activeGroup?.stories[storyIndex];
  const canReact = !!activeStory && !!currentUserId && activeStory.userId !== currentUserId;
  const likedByMe = !!activeStory && !!currentUserId && (activeStory.likedBy || []).includes(currentUserId);

  const storyTimeAgo = useMemo(() => {
    if (!activeStory) return '';
    const mins = Math.floor((Date.now() - new Date(activeStory.createdAt).getTime()) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h`;
  }, [activeStory]);

  useEffect(() => {
    if (!isOpen || !activeStory) return;
    setProgress(0);
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const nextProgress = Math.min(100, (elapsed / 5000) * 100);
      setProgress(nextProgress);
      if (nextProgress >= 100) {
        window.clearInterval(id);
        goNext();
      }
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, groupIndex, storyIndex, activeStory?._id]);

  useEffect(() => {
    if (!isOpen || !activeStory || !currentUserId) return;
    if (activeStory.viewedBy?.includes(currentUserId)) return;
    db.stories.update(activeStory._id, {
      viewedBy: [...(activeStory.viewedBy || []), currentUserId],
    }).catch(() => {});
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(`${BACKEND_URL}/stories/${activeStory._id}/view`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
      }
    })();
  }, [isOpen, activeStory, currentUserId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, groupIndex, storyIndex]);

  const goNext = () => {
    if (!activeGroup) return;
    if (storyIndex < activeGroup.stories.length - 1) {
      setStoryIndex((prev) => prev + 1);
      return;
    }
    if (groupIndex < groups.length - 1) {
      setGroupIndex((prev) => prev + 1);
      setStoryIndex(0);
      return;
    }
    onClose();
  };

  const goPrev = () => {
    if (!activeGroup) return;
    if (storyIndex > 0) {
      setStoryIndex((prev) => prev - 1);
      return;
    }
    if (groupIndex > 0) {
      const prevGroup = groups[groupIndex - 1];
      setGroupIndex((prev) => prev - 1);
      setStoryIndex(Math.max(0, prevGroup.stories.length - 1));
    }
  };

  const createStoryNotification = async (payload: { type: 'story_like' | 'story_reply'; text?: string }) => {
    if (!activeStory || !currentUserId || activeStory.userId === currentUserId) return;
    await db.storyNotifications.put({
      _id:
        payload.type === 'story_like'
          ? `story_notif_like_${activeStory._id}_${currentUserId}`
          : `story_notif_reply_${activeStory._id}_${Date.now()}`,
      userId: activeStory.userId,
      actorId: currentUserId,
      actorName: currentUserName || 'User',
      actorAvatar: currentUserAvatar || '',
      storyId: activeStory._id,
      type: payload.type,
      text: payload.text || '',
      createdAt: new Date(),
      read: false,
    });
  };

  const toggleLikeStory = async () => {
    if (!activeStory || !currentUserId || !canReact) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${BACKEND_URL}/stories/${activeStory._id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
      await db.stories.update(activeStory._id, { likedBy });
      if (data.liked) {
        await createStoryNotification({ type: 'story_like' });
      } else {
        await db.storyNotifications.delete(`story_notif_like_${activeStory._id}_${currentUserId}`);
      }
    } catch {
    }
  };

  const sendReply = async () => {
    if (!activeStory || !canReact || !currentUserId) return;
    const text = replyText.trim();
    if (!text || sendingReply) return;

    setSendingReply(true);
    try {
      await createStoryNotification({ type: 'story_reply', text });

      // Also deliver as DM, similar to Instagram story replies.
      try {
        const token = await getToken();
        if (token) {
          const storyReplyRes = await fetch(`${BACKEND_URL}/stories/${activeStory._id}/reply`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ text }),
          });
          if (!storyReplyRes.ok) throw new Error('Story reply failed');
        }
      } catch {
      }

      setReplyText('');
    } finally {
      setSendingReply(false);
    }
  };

  if (!mounted || !isOpen || !activeGroup || !activeStory) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] bg-black flex items-center justify-center">
      <div className="relative w-full h-[100dvh] sm:h-[92dvh] sm:max-h-[860px] sm:max-w-[460px] bg-black overflow-hidden sm:rounded-2xl">
        <div className="absolute top-0 left-0 right-0 z-20 px-3 pt-3">
          <div className="flex items-center gap-1 mb-2">
            {activeGroup.stories.map((story, idx) => (
              <div key={story._id} className="flex-1 h-[3px] rounded-full bg-white/30 overflow-hidden">
                <div
                  className="h-full bg-white transition-[width] duration-100"
                  style={{
                    width: idx < storyIndex ? '100%' : idx === storyIndex ? `${progress}%` : '0%',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeGroup.avatarUrl ? (
                <img src={activeGroup.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-white/50" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-white/20 text-white text-xs font-bold flex items-center justify-center">
                  {(activeGroup.displayName || 'U')[0].toUpperCase()}
                </div>
              )}
              <p className="text-white text-sm font-semibold">{activeGroup.displayName || 'User'}</p>
              <p className="text-white/70 text-xs">{storyTimeAgo}</p>
            </div>
            <button onClick={onClose} className="text-white/90">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <img src={activeStory.imageUrl} alt="" className="w-full h-full object-cover" />

        {activeStory.text && (
          <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none">
            <p
              className="font-bold text-center leading-tight break-words max-w-full"
              style={{
                color: activeStory.textColor || '#ffffff',
                textShadow: '0 2px 12px rgba(0,0,0,0.7)',
                fontSize: `${activeStory.textSize || 42}px`,
              }}
            >
              {activeStory.text}
            </p>
          </div>
        )}

        {canReact && (
          <div className="absolute left-3 right-3 bottom-3 z-20 flex items-center gap-2">
            <div className="flex-1 h-11 rounded-full border border-white/40 bg-black/25 backdrop-blur-sm flex items-center px-4">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 300))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Reply to story..."
                className="w-full bg-transparent text-white text-sm placeholder:text-white/70 outline-none"
              />
            </div>
            <button
              onClick={toggleLikeStory}
              className={`w-11 h-11 rounded-full border border-white/40 backdrop-blur-sm flex items-center justify-center ${
                likedByMe ? 'bg-[#ed4956] text-white' : 'bg-black/25 text-white'
              }`}
              aria-label="Like story"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M12 21s-7.5-4.35-9.5-8.5A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6.5C19.5 16.65 12 21 12 21z" />
              </svg>
            </button>
            <button
              onClick={sendReply}
              disabled={!replyText.trim() || sendingReply}
              className="h-11 px-4 rounded-full bg-[#0095f6] text-white text-sm font-semibold disabled:opacity-45"
            >
              {sendingReply ? '...' : 'Send'}
            </button>
          </div>
        )}

        <button
          onClick={goPrev}
          className={`absolute left-0 top-0 ${canReact ? 'bottom-[72px]' : 'bottom-0'} w-1/3`}
          aria-label="Previous story"
        />
        <button
          onClick={goNext}
          className={`absolute right-0 top-0 ${canReact ? 'bottom-[72px]' : 'bottom-0'} w-2/3`}
          aria-label="Next story"
        />
      </div>
    </div>,
    document.body
  );
}

