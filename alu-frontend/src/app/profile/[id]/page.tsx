'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { getProfileShareUrl } from '@/app/lib/publicUrl';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AluLogo } from '@/app/components/icons';

interface PublicProfile {
  userId: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  counts?: { posts: number; shorts: number; videos: number };
  followersCount?: number;
  followingCount?: number;
}

interface PublicPost {
  _id: string;
  userId: string;
  contentUrl: string;
  mediaType: 'image' | 'video';
  videoType?: 'short' | 'long';
  safePrompt?: string;
  thumbnailUrl?: string;
  timestamp: string;
}

function normalizeAvatarUrl(raw?: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
  }
  return '';
}

export default function PublicProfilePage() {
  const params = useParams();
  const userId = String(params.id || '');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [sharing, setSharing] = useState(false);

  const avatarUrl = normalizeAvatarUrl(profile?.avatarUrl || '');
  const displayName = profile?.displayName || 'Alu User';
  const initials = (displayName || 'U')[0].toUpperCase();

  const counts = useMemo(() => {
    const all = posts.length;
    const shorts = posts.filter((p) => p.mediaType === 'video' && p.videoType === 'short').length;
    const videos = posts.filter((p) => p.mediaType === 'video' && p.videoType === 'long').length;
    const images = all - shorts - videos;
    return { all, images, shorts, videos };
  }, [posts]);

  useEffect(() => {
    let ignore = false;

    const run = async () => {
      if (!userId) {
        setError('Profile not found');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError('');
        setAvatarBroken(false);

        const [profileRes, feedRes] = await Promise.all([
          fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`),
          fetch(`${BACKEND_URL}/sync/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }),
        ]);

        if (!profileRes.ok) throw new Error('Profile not found');
        const profileData = await profileRes.json();

        const feedData = feedRes.ok ? await feedRes.json() : { changes: [] };
        const userPosts = (Array.isArray(feedData?.changes) ? feedData.changes : [])
          .filter((p: PublicPost) => p.userId === userId)
          .sort((a: PublicPost, b: PublicPost) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (!ignore) {
          setProfile(profileData);
          setPosts(userPosts);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void run();
    return () => {
      ignore = true;
    };
  }, [userId]);

  const handleShare = async () => {
    if (!userId) return;
    const url = getProfileShareUrl(userId);
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${displayName} on Alu`,
          text: 'Check out this profile on Alu',
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
      }
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--alu-bg)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[var(--alu-bg)] flex items-center justify-center">
        <div className="text-center px-4">
          <div className="flex justify-center mb-4"><AluLogo size={32} /></div>
          <p className="text-alu-text font-semibold">Profile not found</p>
          <Link href="/" className="text-sm text-[var(--alu-primary)] mt-2 inline-block hover:underline">
            Back to Alu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--alu-bg)]">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)] h-14 flex items-center px-4 gap-3">
        <Link href="/" className="shrink-0"><AluLogo size={22} /></Link>
        <div className="flex-1" />
        <button
          onClick={handleShare}
          disabled={sharing}
          className="text-sm text-[var(--alu-primary)] font-medium hover:underline disabled:opacity-50"
        >
          {sharing ? 'Sharing...' : 'Share'}
        </button>
      </header>

      <main className="max-w-[980px] mx-auto px-4 py-6">
        <div className="flex items-center gap-5 border-b border-alu-border pb-5">
          <div className="w-24 h-24 rounded-full bg-alu-surface overflow-hidden ring-1 ring-alu-border flex items-center justify-center">
            {avatarUrl && !avatarBroken ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <span className="text-3xl font-bold text-alu-text-secondary">{initials}</span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-alu-text">{displayName}</h1>
            {profile.bio ? <p className="text-sm text-alu-text-secondary mt-1">{profile.bio}</p> : null}
            <div className="flex gap-4 mt-3 text-sm text-alu-text-secondary">
              <span><strong className="text-alu-text">{counts.all}</strong> posts</span>
              <span><strong className="text-alu-text">{profile.followersCount || 0}</strong> followers</span>
              <span><strong className="text-alu-text">{profile.followingCount || 0}</strong> following</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 md:gap-3">
          {posts.map((p) => (
            <Link
              key={p._id}
              href={`/post/${p._id}`}
              className="block aspect-square bg-alu-surface rounded-lg overflow-hidden"
            >
              {p.mediaType === 'video' ? (
                <>
                  <img
                    src={p.thumbnailUrl || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {!p.thumbnailUrl && (
                    <video src={p.contentUrl} className="w-full h-full object-cover" muted />
                  )}
                </>
              ) : (
                <img src={p.contentUrl} alt={p.safePrompt || ''} className="w-full h-full object-cover" />
              )}
            </Link>
          ))}
        </div>

        {posts.length === 0 && (
          <p className="text-center text-sm text-alu-text-tertiary py-10">No public posts yet.</p>
        )}
      </main>
    </div>
  );
}

