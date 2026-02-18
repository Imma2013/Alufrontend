'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { db, Post } from '../../db';
import { getFileUrl } from '../../fileSystem';
import MediaItem from '../MediaItem';
import { VideosIcon } from '../icons';

interface VideosTabProps {
  searchQuery?: string;
  showAI?: boolean;
  showNormal?: boolean;
}

type FeedMode = 'for-you' | 'following';

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '1:00+';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const formatCount = (value: number): string => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toString();
};

const timeAgo = (date: Date | string): string => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

export default function VideosTab({
  searchQuery = '',
  showAI = true,
  showNormal = true,
}: VideosTabProps) {
  const router = useRouter();
  const { user } = useUser();
  const { getToken } = useAuth();

  const [feedMode, setFeedMode] = useState<FeedMode>('for-you');
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);
  const [creatorAvatarByUser, setCreatorAvatarByUser] = useState<Record<string, string>>({});
  const [brokenCreatorAvatars, setBrokenCreatorAvatars] = useState<Record<string, boolean>>({});
  const [followingBusyUserId, setFollowingBusyUserId] = useState<string | null>(null);
  const [durationMap, setDurationMap] = useState<Record<string, string>>({});
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
  const [previewSrcMap, setPreviewSrcMap] = useState<Record<string, string>>({});
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

  const videos = useLiveQuery(
    async () => {
      const all = await db.posts.where('mediaType').equals('video').toArray();
      return all
        .filter((p: Post) => p.videoType === 'long')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadFollowing = async () => {
      if (!user?.id) {
        setFollowingUserIds([]);
        return;
      }

      try {
        const token = await getToken();
        const backendUrl = BACKEND_URL;
        const res = await fetch(`${backendUrl}/users/${user.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setFollowingUserIds([]);
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setFollowingUserIds(Array.isArray(data.following) ? data.following : []);
        }
      } catch {
        if (!cancelled) setFollowingUserIds([]);
      }
    };

    void loadFollowing();
    return () => {
      cancelled = true;
    };
  }, [user?.id, getToken]);

  const toggleFollow = async (creatorUserId: string) => {
    if (!user?.id || creatorUserId === user.id) return;
    const token = await getToken();
    if (!token) return;

    const isFollowing = followingUserIds.includes(creatorUserId);
    const endpoint = isFollowing ? 'unfollow' : 'follow';
    const backendUrl = BACKEND_URL;
    setFollowingBusyUserId(creatorUserId);
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
      setFollowingUserIds((prev) =>
        isFollowing ? prev.filter((id) => id !== creatorUserId) : [...prev, creatorUserId]
      );
    } catch {
    } finally {
      setFollowingBusyUserId(null);
    }
  };

  const scopedVideos = useMemo(() => {
    const searched = (videos || []).filter((p: Post) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        p.safePrompt?.toLowerCase().includes(q) ||
        p.displayName?.toLowerCase().includes(q) ||
        p.caption?.toLowerCase().includes(q)
      );
    });

    const byMode =
      feedMode === 'following'
        ? searched.filter((p) => followingUserIds.includes(p.userId))
        : searched;

    return byMode.filter((p) => {
      if (p.is_ai) return showAI;
      return showNormal;
    });
  }, [videos, searchQuery, feedMode, followingUserIds, showAI, showNormal]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCreatorProfiles = async () => {
      const userIds = Array.from(new Set(scopedVideos.map((p) => p.userId).filter(Boolean)));
      const missing = userIds.filter((id) => !creatorAvatarByUser[id]);
      if (missing.length === 0) return;

      try {
        const token = await getToken();
        await Promise.all(
          missing.slice(0, 30).map(async (uid) => {
            const res = await fetch(`${BACKEND_URL}/users/${uid}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) return;
            const profile = await res.json();
            if (!cancelled) {
              setCreatorAvatarByUser((prev) => ({ ...prev, [uid]: profile.avatarUrl || '' }));
            }
          })
        );
      } catch {
      }
    };

    if (scopedVideos.length > 0) {
      void hydrateCreatorProfiles();
    }
    return () => {
      cancelled = true;
    };
  }, [scopedVideos, creatorAvatarByUser, getToken]);

  useEffect(() => {
    let cancelled = false;

    const loadDurations = async () => {
      const nextEntries = await Promise.all(
        scopedVideos.map(async (video) => {
          if (durationMap[video._id]) return null;

          let src = '';
          let revoke = false;

          try {
            if (video.contentUrl.startsWith('http')) {
              src = video.contentUrl;
            } else {
              src = await getFileUrl(video.contentUrl);
              revoke = true;
            }

            const duration = await new Promise<string>((resolve) => {
              const media = document.createElement('video');
              media.preload = 'metadata';
              media.src = src;
              media.onloadedmetadata = () => resolve(formatDuration(media.duration));
              media.onerror = () => resolve('1:00+');
              setTimeout(() => resolve('1:00+'), 1500);
            });

            return [video._id, duration] as const;
          } catch {
            return [video._id, '1:00+'] as const;
          } finally {
            if (revoke && src) URL.revokeObjectURL(src);
          }
        })
      );

      if (cancelled) return;
      const patch = Object.fromEntries(nextEntries.filter(Boolean) as Array<[string, string]>);
      if (Object.keys(patch).length > 0) {
        setDurationMap((prev) => ({ ...prev, ...patch }));
      }
    };

    if (scopedVideos.length > 0) {
      void loadDurations();
    }

    return () => {
      cancelled = true;
    };
  }, [scopedVideos, durationMap]);

  useEffect(() => {
    let cancelled = false;

    const loadPreviewSource = async () => {
      if (!hoveredVideoId || previewSrcMap[hoveredVideoId]) return;
      const video = scopedVideos.find((item) => item._id === hoveredVideoId);
      if (!video) return;

      try {
        const src = video.contentUrl.startsWith('http') ? video.contentUrl : await getFileUrl(video.contentUrl);
        if (!cancelled) {
          setPreviewSrcMap((prev) => ({ ...prev, [hoveredVideoId]: src }));
        }
      } catch {
        if (!cancelled) {
          setPreviewSrcMap((prev) => ({ ...prev, [hoveredVideoId]: '' }));
        }
      }
    };

    void loadPreviewSource();
    return () => {
      cancelled = true;
    };
  }, [hoveredVideoId, scopedVideos, previewSrcMap]);

  return (
    <div className="w-full max-w-[2100px] mx-auto px-0 sm:px-3 md:px-6 pb-8 animate-fade-in">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-alu-border mb-3 px-2 sm:px-1 shadow-[0_1px_0_0_rgba(0,0,0,0.03)]">
        <div className="py-3 overflow-x-auto hide-scrollbar">
          <div className="flex items-center gap-2 min-w-max pr-2">
            <button
              onClick={() => setFeedMode('for-you')}
              className={`px-3.5 h-8 rounded-lg text-sm font-semibold transition-colors ${
                feedMode === 'for-you'
                  ? 'bg-[#0f0f0f] text-white'
                  : 'bg-[#f2f2f2] text-[#0f0f0f] hover:bg-[#e5e5e5]'
              }`}
            >
              For You
            </button>
            <button
              onClick={() => setFeedMode('following')}
              className={`px-3.5 h-8 rounded-lg text-sm font-semibold transition-colors ${
                feedMode === 'following'
                  ? 'bg-[#0f0f0f] text-white'
                  : 'bg-[#f2f2f2] text-[#0f0f0f] hover:bg-[#e5e5e5]'
              }`}
            >
              Following
            </button>
          </div>
        </div>
      </div>

      {scopedVideos.length === 0 ? (
        <div className="w-full max-w-[1900px] mx-auto px-2 sm:px-4 md:px-6 animate-fade-in">
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-alu-surface flex items-center justify-center mx-auto mb-4 text-alu-text-tertiary border border-alu-border">
              <VideosIcon size={28} />
            </div>
            <p className="text-base font-semibold text-alu-text mb-1">
              {feedMode === 'following' ? 'No videos from people you follow yet' : 'No videos found'}
            </p>
            <p className="text-sm text-alu-text-tertiary">
              {feedMode === 'following'
                ? 'Follow more creators to build your Following feed'
                : 'Try another search or upload your first long-form video'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6 md:gap-y-8 px-2 sm:px-1">
          {scopedVideos.map((video) => {
            const previewSrc = previewSrcMap[video._id];
            const isHovered = hoveredVideoId === video._id;
            const likes = Number.isFinite(video.likes) ? (video.likes as number) : 0;
            const isOwnVideo = video.userId === user?.id;
            const isFollowingCreator = followingUserIds.includes(video.userId);
            const creatorAvatar = normalizeAvatarUrl(video.avatarUrl || creatorAvatarByUser[video.userId] || '');
            const creatorAvatarKey = `${video.userId || 'anon'}:${video._id}`;

            return (
              <button
                key={video._id}
                className="group text-left w-full"
                onClick={() => router.push(`/watch/${video._id}`)}
                aria-label={`Open video ${video.safePrompt || 'Video'}`}
                onMouseEnter={() => setHoveredVideoId(video._id)}
                onMouseLeave={() => setHoveredVideoId((prev) => (prev === video._id ? null : prev))}
              >
                <div className="w-full aspect-video rounded-xl overflow-hidden relative bg-alu-surface">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      className={`w-full h-full object-cover transition-opacity duration-300 ${isHovered && previewSrc ? 'opacity-0' : 'opacity-100'}`}
                    />
                  ) : (
                    <div className="w-full h-full">
                      <MediaItem post={video} />
                    </div>
                  )}

                  {previewSrc && (
                    <video
                      src={previewSrc}
                      muted
                      autoPlay={isHovered}
                      loop
                      playsInline
                      preload="metadata"
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
                    />
                  )}

                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="w-12 h-12 rounded-full bg-black/65 backdrop-blur-sm flex items-center justify-center md:hidden">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                        <polygon points="8,5 19,12 8,19" />
                      </svg>
                    </div>
                  </div>

                  <div className="absolute bottom-2 right-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-black/85 text-white">
                    {durationMap[video._id] || '1:00+'}
                  </div>

                  {video.is_ai && (
                    <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded bg-black/65 text-white backdrop-blur-sm">
                      AI
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-2.5 px-0.5">
                  {creatorAvatar && !brokenCreatorAvatars[creatorAvatarKey] ? (
                    <img
                      src={creatorAvatar}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5 border border-alu-border"
                      onError={() => setBrokenCreatorAvatars((prev) => ({ ...prev, [creatorAvatarKey]: true }))}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-alu-surface flex items-center justify-center text-xs font-semibold text-alu-text-secondary shrink-0 mt-0.5 border border-alu-border">
                      {(video.displayName || video.userId || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] md:text-[15px] font-semibold text-[#0f0f0f] leading-snug line-clamp-2">
                      {video.safePrompt || video.caption || 'Untitled video'}
                    </h3>
                    <p className="text-[12px] md:text-[13px] text-[#606060] mt-1 line-clamp-1">
                      {video.displayName || 'Alu User'}
                    </p>
                    {!isOwnVideo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFollow(video.userId);
                        }}
                        disabled={followingBusyUserId === video.userId}
                        className="text-[12px] font-semibold text-[#065fd4] hover:text-[#0b57d0] disabled:opacity-50"
                      >
                        {isFollowingCreator ? 'Following' : 'Follow'}
                      </button>
                    )}
                    <p className="text-xs text-[#606060] mt-0.5">
                      {formatCount(likes)} likes - {timeAgo(video.timestamp)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}



