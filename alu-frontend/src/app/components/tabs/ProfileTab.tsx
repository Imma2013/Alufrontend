'use client';

import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUser, useClerk, useAuth } from '@clerk/nextjs';
import { db, Post } from '../../db';
import MediaItem from '../MediaItem';
import { SettingsIcon, ShieldIcon, FileTextIcon, LogOutIcon, MoreVertIcon, ShortsIcon, VideosIcon, HeartIcon, BookmarkIcon } from '../icons';
import PrivacyPolicy from '../PrivacyPolicy';
import TermsConditions from '../TermsConditions';
import EditProfile from '../EditProfile';
import PostModal from '../PostModal';
import PostOptionsMenu from '../PostOptionsMenu';
import EditCaptionModal from '../EditCaptionModal';

type ContentTab = 'posts' | 'shorts' | 'videos' | 'likes' | 'favorites';

interface ProfileTabProps {
  viewUserId?: string | null;
  onBack?: () => void;
  onViewUser?: (userId: string) => void;
}

interface OtherUserProfile {
  userId: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  isPro: boolean;
  followersCount: number;
  followingCount: number;
  followers: string[];
  following: string[];
  counts: { posts: number; shorts: number; videos: number };
}

export default function ProfileTab({ viewUserId, onBack, onViewUser }: ProfileTabProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const userId = user?.id;
  const isOwnProfile = !viewUserId || viewUserId === userId;

  const [activeContentTab, setActiveContentTab] = useState<ContentTab>('posts');
  const [showSettings, setShowSettings] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [profileShowAI, setProfileShowAI] = useState(true);
  const [profileShowNormal, setProfileShowNormal] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Other user state
  const [otherUser, setOtherUser] = useState<OtherUserProfile | null>(null);
  const [otherUserPosts, setOtherUserPosts] = useState<Post[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Favorites state
  const [favoritePosts, setFavoritePosts] = useState<Post[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [ownFollowersCount, setOwnFollowersCount] = useState(0);
  const [ownFollowingCount, setOwnFollowingCount] = useState(0);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  // Fetch own follower counts
  useEffect(() => {
    if (!isOwnProfile || !userId) return;
    fetch(`${backendUrl}/users/${userId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setOwnFollowersCount(data.followersCount || 0);
          setOwnFollowingCount(data.followingCount || 0);
        }
      })
      .catch(() => {});
  }, [isOwnProfile, userId, backendUrl]);

  // Fetch other user's profile + posts when viewing someone else
  useEffect(() => {
    if (isOwnProfile || !viewUserId) {
      setOtherUser(null);
      setOtherUserPosts([]);
      return;
    }

    setLoadingProfile(true);
    setActiveContentTab('posts');

    Promise.all([
      fetch(`${backendUrl}/users/${viewUserId}`)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
      fetch(`${backendUrl}/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
        .then(res => res.ok ? res.json() : { changes: [] })
        .catch(() => ({ changes: [] })),
    ]).then(([profileData, syncData]) => {
      if (profileData) {
        setOtherUser(profileData);
        setFollowersCount(profileData.followersCount || 0);
        setFollowingCount(profileData.followingCount || 0);
        setIsFollowing(profileData.followers?.includes(userId || '') || false);
      }
      const userPosts = (syncData.changes || [])
        .filter((p: Post) => p.userId === viewUserId)
        .sort((a: Post, b: Post) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setOtherUserPosts(userPosts);
    }).finally(() => setLoadingProfile(false));
  }, [viewUserId, isOwnProfile, userId, backendUrl]);

  // Real data from Dexie — own posts
  const ownPosts = useLiveQuery(
    async () => {
      if (!userId || !isOwnProfile) return [] as Post[];
      return db.posts.where('userId').equals(userId).reverse().sortBy('timestamp');
    },
    [userId, isOwnProfile]
  );

  const userPosts = isOwnProfile ? (ownPosts || []) : otherUserPosts;

  // Fetch favorites when favorites tab is active
  useEffect(() => {
    if (activeContentTab !== 'favorites' || !isOwnProfile) {
      setFavoritePosts([]);
      return;
    }

    const fetchFavorites = async () => {
      setLoadingFavorites(true);
      try {
        const token = await getToken();
        if (!token) return;

        const res = await fetch(`${backendUrl}/posts/favorites`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          setFavoritePosts(data.posts || []);
        }
      } catch (err) {
        console.error('Failed to fetch favorites:', err);
      } finally {
        setLoadingFavorites(false);
      }
    };

    fetchFavorites();
  }, [activeContentTab, isOwnProfile, backendUrl, getToken]);

  const toggleProfileAI = () => {
    if (profileShowAI && !profileShowNormal) return;
    setProfileShowAI(!profileShowAI);
  };
  const toggleProfileNormal = () => {
    if (profileShowNormal && !profileShowAI) return;
    setProfileShowNormal(!profileShowNormal);
  };

  const contentTabs: { key: ContentTab; label: string; icon: JSX.Element }[] = isOwnProfile
    ? [
        {
          key: 'posts',
          label: 'Posts',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          ),
        },
        { key: 'shorts', label: 'Shorts', icon: <ShortsIcon size={20} /> },
        { key: 'videos', label: 'Videos', icon: <VideosIcon size={20} /> },
        { key: 'likes', label: 'Likes', icon: <HeartIcon size={20} /> },
        { key: 'favorites', label: 'Favorites', icon: <BookmarkIcon size={20} /> },
      ]
    : [
        {
          key: 'posts',
          label: 'Posts',
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          ),
        },
        { key: 'shorts', label: 'Shorts', icon: <ShortsIcon size={20} /> },
        { key: 'videos', label: 'Videos', icon: <VideosIcon size={20} /> },
      ];

  // Use favoritePosts when on favorites tab, otherwise use userPosts
  const sourcePostsForTab = activeContentTab === 'favorites' ? favoritePosts : userPosts;

  const tabFiltered = sourcePostsForTab.filter((p: Post) => {
    if (activeContentTab === 'posts') return p.mediaType === 'image';
    if (activeContentTab === 'shorts') return p.mediaType === 'video' && (!p.videoType || p.videoType === 'short');
    if (activeContentTab === 'videos') return p.mediaType === 'video' && p.videoType === 'long';
    if (activeContentTab === 'favorites') return true; // Show all favorited content
    return true;
  });

  const currentContent = tabFiltered.filter((p: Post) => {
    if (profileShowAI && profileShowNormal) return true;
    if (profileShowAI && !profileShowNormal) return p.is_ai;
    if (!profileShowAI && profileShowNormal) return !p.is_ai;
    return true;
  });

  const totalPosts = userPosts.length;
  const ownDisplayName = user?.firstName || user?.username || 'You';
  const ownAvatarLetter = ownDisplayName[0]?.toUpperCase() || 'U';
  const ownBio = (user?.unsafeMetadata?.bio as string) || 'Creating on Alu';

  const otherDisplayName = otherUser?.displayName || 'User';
  const otherAvatarLetter = otherDisplayName[0]?.toUpperCase() || 'U';
  const otherBio = otherUser?.bio || '';

  const handleShareProfile = async () => {
    const profileUrl = `${window.location.origin}/profile/${isOwnProfile ? (user?.id || '') : (viewUserId || '')}`;
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = profileUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleFollow = async () => {
    const token = await getToken();
    if (!token || !viewUserId) return;
    const endpoint = isFollowing ? 'unfollow' : 'follow';
    try {
      const res = await fetch(`${backendUrl}/users/${viewUserId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ displayName: user?.fullName || '', avatarUrl: user?.imageUrl || '' }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.followed);
        setFollowersCount(prev => data.followed ? prev + 1 : Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Follow/unfollow failed:', err);
    }
  };

  const handlePostDeleted = (postId: string) => {
    setSelectedPost(null);
    // Force re-render by removing from local state if viewing other user
    if (!isOwnProfile) {
      setOtherUserPosts(prev => prev.filter(p => p._id !== postId));
    }
  };

  const handleDeletePost = async () => {
    if (!deletingPost) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
      if (!token) return;

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
      const res = await fetch(`${backendUrl}/posts/${deletingPost._id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        // Remove from local Dexie
        try { await db.posts.delete(deletingPost._id); } catch { /* ok */ }
        // Remove from other user posts if applicable
        if (!isOwnProfile) {
          setOtherUserPosts(prev => prev.filter(p => p._id !== deletingPost._id));
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setIsDeleting(false);
      setDeletingPost(null);
    }
  };

  const handleUpgrade = async (mode: 'subscription' | 'payment') => {
    const token = await getToken();
    if (!token) return;
    try {
      setUpgradeError(null);
      const proPriceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
      const creditPriceId = process.env.NEXT_PUBLIC_STRIPE_CREDIT_PRICE_ID;
      const priceId = mode === 'subscription' ? proPriceId : creditPriceId;
      if (!priceId) {
        throw new Error(
          mode === 'subscription'
            ? 'Stripe Pro price is not configured.'
            : 'Stripe credit pack price is not configured.'
        );
      }

      const res = await fetch(`${backendUrl}/payments/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ priceId, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Unable to start checkout session.');
      }
      if (data.url) {
        window.location.assign(data.url);
      } else {
        throw new Error('Checkout URL missing from server response.');
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      const message = err instanceof Error ? err.message : 'Checkout failed.';
      setUpgradeError(message);
    }
  };

  if (!isOwnProfile && loadingProfile) {
    return (
      <div className="w-full max-w-[600px] mx-auto animate-fade-in">
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-alu-text-tertiary">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] mx-auto animate-fade-in">
      {/* Back button for other user profiles */}
      {!isOwnProfile && (
        <div className="px-4 pt-3 pb-1">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-alu-text-secondary hover:text-alu-text transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15,18 9,12 15,6" />
            </svg>
            Back
          </button>
        </div>
      )}

      {/* Profile Header */}
      <div className="px-4 pt-4 pb-5 border-b border-alu-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[20px] font-bold text-alu-text leading-none">
            {isOwnProfile ? ownDisplayName : otherDisplayName}
          </h2>
          {isOwnProfile && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-alu-text-secondary hover:text-alu-text transition-colors"
              aria-label="Profile settings"
            >
              <SettingsIcon size={21} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-alu-surface flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-alu-border">
            {isOwnProfile ? (
              user?.imageUrl ? (
                <img src={user.imageUrl} alt={ownDisplayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-alu-text-secondary">{ownAvatarLetter}</span>
              )
            ) : (
              otherUser?.avatarUrl ? (
                <img src={otherUser.avatarUrl} alt={otherDisplayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-alu-text-secondary">{otherAvatarLetter}</span>
              )
            )}
          </div>

          <div className="flex-1 grid grid-cols-3 gap-3">
            <div className="text-center">
              <span className="text-[17px] font-bold text-alu-text block leading-none">
                {isOwnProfile
                  ? totalPosts
                  : (otherUser?.counts?.posts ?? 0) + (otherUser?.counts?.shorts ?? 0) + (otherUser?.counts?.videos ?? 0)}
              </span>
              <span className="text-xs text-alu-text-tertiary">Posts</span>
            </div>
            <div className="text-center">
              <span className="text-[17px] font-bold text-alu-text block leading-none">
                {isOwnProfile ? ownFollowersCount : followersCount}
              </span>
              <span className="text-xs text-alu-text-tertiary">Followers</span>
            </div>
            <div className="text-center">
              <span className="text-[17px] font-bold text-alu-text block leading-none">
                {isOwnProfile ? ownFollowingCount : followingCount}
              </span>
              <span className="text-xs text-alu-text-tertiary">Following</span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold text-alu-text mb-0.5">{isOwnProfile ? ownDisplayName : otherDisplayName}</p>
          <p className="text-sm text-alu-text-secondary break-words">{isOwnProfile ? ownBio : otherBio}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-4">
          {isOwnProfile ? (
            <>
              <button
                onClick={() => setShowEditProfile(true)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors border border-alu-border"
              >
                Edit Profile
              </button>
              <button
                onClick={handleShareProfile}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors border border-alu-border"
              >
                {copiedLink ? 'Copied!' : 'Share Profile'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleFollow}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isFollowing
                    ? 'bg-alu-surface text-alu-text hover:bg-alu-border border border-alu-border'
                    : 'bg-[#0095f6] text-white hover:bg-[#1084d7]'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
              <button
                onClick={handleShareProfile}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors border border-alu-border"
              >
                {copiedLink ? 'Copied!' : 'Share Profile'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Settings dropdown (own profile only) */}
      {isOwnProfile && showSettings && (
        <div className="mx-4 mb-4 p-2 bg-alu-surface rounded-xl animate-fade-in">
          <button
            onClick={() => { setUpgradeError(null); setShowUpgradeModal(true); setShowSettings(false); }}
            className="w-full text-left px-3 py-2.5 text-sm text-alu-text hover:bg-alu-hover rounded-lg transition-colors flex items-center gap-2.5"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Upgrade to Pro
          </button>
          <button
            onClick={() => { setShowPrivacy(true); setShowSettings(false); }}
            className="w-full text-left px-3 py-2.5 text-sm text-alu-text hover:bg-alu-hover rounded-lg transition-colors flex items-center gap-2.5"
          >
            <ShieldIcon size={18} />
            Privacy
          </button>
          <button
            onClick={() => { setShowTerms(true); setShowSettings(false); }}
            className="w-full text-left px-3 py-2.5 text-sm text-alu-text hover:bg-alu-hover rounded-lg transition-colors flex items-center gap-2.5"
          >
            <FileTextIcon size={18} />
            Terms & Conditions
          </button>
          <button
            onClick={() => signOut()}
            className="w-full text-left px-3 py-2.5 text-sm text-alu-danger hover:bg-alu-hover rounded-lg transition-colors flex items-center gap-2.5"
          >
            <LogOutIcon size={18} />
            Log Out
          </button>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowUpgradeModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-[400px] w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-alu-text text-center mb-1">Upgrade Your Plan</h3>
            <p className="text-sm text-alu-text-secondary text-center mb-5">Get more out of Alu</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleUpgrade('subscription')}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
              >
                Pro Monthly — $10/mo
                <span className="block text-xs font-normal opacity-80 mt-0.5">10x daily limits for everything</span>
              </button>
              <button
                onClick={() => handleUpgrade('payment')}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors"
              >
                Credit Pack — $10
                <span className="block text-xs font-normal text-alu-text-secondary mt-0.5">+50 images, +20 shorts, +10 videos</span>
              </button>
            </div>
            {upgradeError && (
              <p className="mt-3 text-xs text-red-600 text-center">{upgradeError}</p>
            )}

            <button
              onClick={() => setShowUpgradeModal(false)}
              className="w-full mt-3 py-2 text-sm text-alu-text-tertiary hover:text-alu-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Overlays (own profile only) */}
      {isOwnProfile && showPrivacy && <PrivacyPolicy onBack={() => setShowPrivacy(false)} />}
      {isOwnProfile && showTerms && <TermsConditions onBack={() => setShowTerms(false)} />}
      {isOwnProfile && showEditProfile && <EditProfile onBack={() => setShowEditProfile(false)} />}

      {/* Post expand modal */}
      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onViewUser={onViewUser}
          onDeleted={handlePostDeleted}
        />
      )}

      {/* Content Tabs */}
      <div className="border-b border-alu-border">
        <div className="flex overflow-x-auto hide-scrollbar">
          {contentTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveContentTab(tab.key)}
              className={`flex-1 min-w-[72px] py-2.5 text-[11px] font-semibold text-center transition-all duration-200 border-b-2 ${
                activeContentTab === tab.key
                  ? 'border-alu-text text-alu-text'
                  : 'border-transparent text-alu-text-tertiary hover:text-alu-text-secondary'
              }`}
            >
              <span className="flex flex-col items-center gap-1">
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* AI / Normal filter */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-alu-border-light bg-white">
        <span className="text-xs text-alu-text-tertiary mr-1">Show:</span>
        <button
          onClick={toggleProfileAI}
          className={`toggle-pill px-3 py-1 rounded-full text-xs font-medium ${
            profileShowAI ? 'bg-alu-text text-white' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'
          }`}
        >
          AI
        </button>
        <button
          onClick={toggleProfileNormal}
          className={`toggle-pill px-3 py-1 rounded-full text-xs font-medium ${
            profileShowNormal ? 'bg-alu-text text-white' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'
          }`}
        >
          Normal
        </button>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-3 gap-px bg-alu-border">
        {currentContent.length > 0 ? (
          currentContent.map((post) => (
            <div
              key={post._id}
              className="aspect-square relative overflow-hidden bg-white group"
            >
              <div className="cursor-pointer" onClick={() => setSelectedPost(post)}>
                <MediaItem post={post} />
              </div>
              {post.is_ai && (
                <div className="absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/40 text-white backdrop-blur-sm z-10">
                  AI
                </div>
              )}
              {isOwnProfile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuPost(post);
                  }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity"
                >
                  <MoreVertIcon size={20} />
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-3 py-16 text-center">
            <p className="text-sm text-alu-text-tertiary">
              {loadingProfile ? 'Loading...' : 'Nothing here yet'}
            </p>
          </div>
        )}
      </div>

      {/* Post Options Menu */}
      {menuPost && (
        <PostOptionsMenu
          post={menuPost}
          onClose={() => setMenuPost(null)}
          onEdit={() => { setEditingPost(menuPost); setMenuPost(null); }}
          onCopyLink={async () => {
            const url = `${window.location.origin}/post/${menuPost._id}`;
            try {
              await navigator.clipboard.writeText(url);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            } catch { /* silent */ }
          }}
          onDelete={() => { setDeletingPost(menuPost); setMenuPost(null); }}
        />
      )}

      {/* Edit Caption Modal */}
      {editingPost && (
        <EditCaptionModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={(newCaption) => {
            // Caption updated, refresh will happen via Dexie live query
            setEditingPost(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deletingPost && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center" onClick={() => setDeletingPost(null)}>
          <div className="bg-white dark:bg-alu-bg rounded-2xl p-6 max-w-[320px] mx-4 text-center" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-alu-text mb-2">Delete this post?</h3>
            <p className="text-sm text-alu-text-secondary mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeletingPost(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePost}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copied Link Toast */}
      {copiedLink && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded-full animate-fade-in z-[130]">
          Link copied!
        </div>
      )}
    </div>
  );
}
