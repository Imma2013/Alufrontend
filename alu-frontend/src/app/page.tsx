'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useState, useEffect } from 'react';
import { UserButton, useUser, SignInButton, useAuth } from '@clerk/nextjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { initDb, db, Post } from './db';
import {
  HomeIcon,
  ShortsIcon,
  VideosIcon,
  NotificationsIcon,
  MessagesIcon,
  ProfileIcon,
  CreateIcon,
  SearchIcon,
  AluMark,
} from './components/icons';
import HomeTab from './components/tabs/HomeTab';
import ShortsTab from './components/tabs/ShortsTab';
import VideosTab from './components/tabs/VideosTab';
import CreateTab from './components/tabs/CreateTab';
import ProfileTab from './components/tabs/ProfileTab';
import NotificationsTab from './components/tabs/NotificationsTab';
import MessagesTab from './components/tabs/MessagesTab';

type Tab = 'home' | 'shorts' | 'videos' | 'create' | 'profile' | 'notifications' | 'messages';

const TABS_WITH_HEADER: Tab[] = ['home', 'shorts', 'videos'];
const AUTH_REQUIRED_TABS: Tab[] = ['create', 'profile', 'notifications', 'messages'];
const SEARCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'all', 'new', 'now', 'out', 'just', 'into', 'about',
  'what', 'when', 'where', 'how', 'why', 'who', 'its', 'our', 'their', 'they', 'them',
]);

interface SearchUserSuggestion {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

interface DMLaunchRequest {
  user: SearchUserSuggestion & { bio: string };
  requestId: number;
}

function AuthRequiredCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="max-w-[520px] mx-auto px-4 py-10">
      <div className="rounded-2xl border border-alu-border bg-white p-6 shadow-[var(--alu-shadow-sm)] text-center">
        <h3 className="text-xl font-bold text-alu-text">{title}</h3>
        <p className="text-sm text-alu-text-secondary mt-2">{subtitle}</p>
        <div className="mt-5">
          <SignInButton mode="modal">
            <button
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
            >
              Sign In
            </button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}

function BrandWordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <AluMark size={small ? 20 : 26} />
      <span
        className={`font-black tracking-tight leading-none text-[var(--alu-primary-dark)] ${small ? 'text-[18px]' : 'text-[28px]'}`}
      >
        alu
      </span>
    </div>
  );
}

function isNameLikeQuery(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q.length > 32) return false;
  if (!/^[a-z\s]+$/.test(q)) return false;
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.length >= 1 && parts.length <= 3;
}

function scoreUserSuggestion(query: string, user: SearchUserSuggestion): number {
  const q = query.trim().toLowerCase();
  const name = (user.displayName || '').toLowerCase();
  if (!name) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(` ${q}`)) return 60;
  if (name.includes(q)) return 40;
  return 10;
}

function buildKeywordSuggestions(query: string, posts: Post[]): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const frequencies = new Map<string, number>();
  for (const post of posts) {
    const searchable = `${post.safePrompt || ''} ${post.displayName || ''}`.toLowerCase();
    if (!searchable.includes(normalizedQuery)) continue;

    const words = searchable.split(/[^a-z0-9]+/g);
    for (const word of words) {
      if (word.length < 3 || SEARCH_STOPWORDS.has(word)) continue;
      if (!word.includes(normalizedQuery)) continue;
      frequencies.set(word, (frequencies.get(word) || 0) + 1);
    }
  }

  const ranked = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 6);

  return [normalizedQuery, ...ranked.filter((word) => word !== normalizedQuery)].slice(0, 6);
}

export default function App() {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [dmLaunchRequest, setDmLaunchRequest] = useState<DMLaunchRequest | null>(null);

  // Initialize Dexie on mount — handles UpgradeError from primary key change
  useEffect(() => {
    initDb().catch(err => console.error('Failed to initialize database:', err));
  }, []);

  const handleViewUser = (userId: string) => {
    setViewUserId(userId);
    setActiveTab('profile');
  };

  const handleTabChange = (tab: Tab) => {
    if (tab !== 'profile') setViewUserId(null);
    setActiveTab(tab);
  };

  const handleMessageUser = (person: SearchUserSuggestion & { bio: string }) => {
    setDmLaunchRequest({
      user: person,
      requestId: Date.now(),
    });
    setViewUserId(null);
    setActiveTab('messages');
  };

  const [showAI, setShowAI] = useState(true);
  const [showNormal, setShowNormal] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [homeSearchInput, setHomeSearchInput] = useState('');
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [shortsSearchQuery, setShortsSearchQuery] = useState('');
  const [videosSearchQuery, setVideosSearchQuery] = useState('');
  const [homeKeywordSuggestions, setHomeKeywordSuggestions] = useState<string[]>([]);
  const [homePeopleSuggestions, setHomePeopleSuggestions] = useState<SearchUserSuggestion[]>([]);
  const [homeSuggestionOpen, setHomeSuggestionOpen] = useState(false);
  const [homeSuggestionLoading, setHomeSuggestionLoading] = useState(false);
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [dmRealtimeTick, setDmRealtimeTick] = useState(0);
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

  const homePostsForSuggestions = useLiveQuery(
    () => db.posts.orderBy('timestamp').reverse().limit(300).toArray(),
    []
  );

  const activeSearchQuery =
    activeTab === 'home'
      ? homeSearchInput
      : activeTab === 'shorts'
        ? shortsSearchQuery
        : activeTab === 'videos'
          ? videosSearchQuery
          : '';

  const setActiveSearchQuery = (value: string) => {
    if (activeTab === 'home') {
      setHomeSearchInput(value);
      setHomeSuggestionOpen(true);
    }
    if (activeTab === 'shorts') setShortsSearchQuery(value);
    if (activeTab === 'videos') setVideosSearchQuery(value);
  };

  useEffect(() => {
    if (activeTab !== 'home' || !searchOpen) return;

    const q = homeSearchInput.trim();
    if (!q) {
      setHomeKeywordSuggestions([]);
      setHomePeopleSuggestions([]);
      setHomeSuggestionLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setHomeSuggestionLoading(true);
      setHomeKeywordSuggestions(buildKeywordSuggestions(q, homePostsForSuggestions || []));

      try {
        const token = await getToken();
        const backendUrl = BACKEND_URL;
        const res = await fetch(
          `${backendUrl}/users/search?q=${encodeURIComponent(q)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (res.ok) {
          const data = await res.json();
          const users = ((data.users || []) as SearchUserSuggestion[])
            .sort((a, b) => scoreUserSuggestion(q, b) - scoreUserSuggestion(q, a))
            .slice(0, 5);
          setHomePeopleSuggestions(users);
        } else {
          setHomePeopleSuggestions([]);
        }
      } catch {
        setHomePeopleSuggestions([]);
      } finally {
        setHomeSuggestionLoading(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [homeSearchInput, activeTab, searchOpen, homePostsForSuggestions, getToken]);

  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const backendUrl = BACKEND_URL;
        const res = await fetch(`${backendUrl}/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setUnreadNotifications(data.count || 0);
      } catch {
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 20000);
    return () => clearInterval(interval);
  }, [getToken]);

  useEffect(() => {
    const syncSignedInUser = async () => {
      try {
        if (!isSignedIn) return;
        const token = await getToken();
        if (!token) return;
        const backendUrl = BACKEND_URL;
        await fetch(`${backendUrl}/users/me/sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        await fetch(`${backendUrl}/users/me/reconcile`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
      }
    };

    syncSignedInUser();
  }, [getToken, isSignedIn]);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const connectStream = async () => {
      while (!stopped && isSignedIn) {
        try {
          const token = await getToken();
          if (!token) {
            await sleep(1500);
            continue;
          }

          const backendUrl = BACKEND_URL;
          const res = await fetch(`${backendUrl}/dm/stream`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'text/event-stream',
            },
            cache: 'no-store',
            signal: controller.signal,
          });

          if (!res.ok || !res.body) throw new Error('DM stream unavailable');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let splitIndex = buffer.indexOf('\n\n');
            while (splitIndex !== -1) {
              const chunk = buffer.slice(0, splitIndex).trim();
              buffer = buffer.slice(splitIndex + 2);
              const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
              if (dataLine) {
                try {
                  const event = JSON.parse(dataLine.slice(6));
                  if (event?.type && event.type !== 'connected') {
                    setDmRealtimeTick((t) => t + 1);
                  }
                } catch {
                }
              }
              splitIndex = buffer.indexOf('\n\n');
            }
          }
        } catch {
        }

        if (!stopped) await sleep(1500);
      }
    };

    if (isSignedIn) connectStream();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [getToken, isSignedIn]);

  useEffect(() => {
    const fetchUnreadMessages = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const backendUrl = BACKEND_URL;
        const res = await fetch(`${backendUrl}/dm/threads`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const total = (data.threads || []).reduce(
          (sum: number, thread: { unreadCount?: number }) => sum + Number(thread.unreadCount || 0),
          0
        );
        setUnreadMessages(total);
      } catch {
      }
    };

    fetchUnreadMessages();
    const interval = setInterval(fetchUnreadMessages, 8000);
    return () => clearInterval(interval);
  }, [getToken, dmRealtimeTick]);

  useEffect(() => {
    if (activeTab === 'notifications') {
      setUnreadNotifications(0);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'messages') {
      setUnreadMessages(0);
    }
  }, [activeTab]);

  const commitHomeKeywordSearch = (keyword: string) => {
    const q = keyword.trim();
    setHomeSearchInput(q);
    setHomeSearchQuery(q);
    setHomeSuggestionOpen(false);
  };

  const clearSearchForActiveTab = () => {
    if (activeTab === 'home') {
      setHomeSearchInput('');
      setHomeSearchQuery('');
      setHomeSuggestionOpen(false);
      setHomeKeywordSuggestions([]);
      setHomePeopleSuggestions([]);
      return;
    }
    setActiveSearchQuery('');
  };

  const showHomeSuggestions =
    activeTab === 'home' &&
    searchOpen &&
    homeSuggestionOpen &&
    !!homeSearchInput.trim() &&
    (homeSuggestionLoading || homeKeywordSuggestions.length > 0 || homePeopleSuggestions.length > 0);
  const preferProfileResults = isNameLikeQuery(homeSearchInput);

  const isGuest = isLoaded && !isSignedIn;
  const activeTabNeedsAuth = AUTH_REQUIRED_TABS.includes(activeTab);

  const toggleAI = () => {
    // Don't allow both off — if turning AI off, Normal must stay on
    if (showAI && !showNormal) return;
    setShowAI(!showAI);
  };
  const toggleNormal = () => {
    if (showNormal && !showAI) return;
    setShowNormal(!showNormal);
  };

  const showStickyHeader = TABS_WITH_HEADER.includes(activeTab);

  const sidebarItems: { key: Tab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    { key: 'home', label: 'Home', icon: (a) => <HomeIcon active={a} /> },
    { key: 'shorts', label: 'Shorts', icon: (a) => <ShortsIcon active={a} /> },
    { key: 'videos', label: 'Videos', icon: (a) => <VideosIcon active={a} /> },
    { key: 'notifications', label: 'Notifications', icon: (a) => <NotificationsIcon active={a} /> },
    { key: 'messages', label: 'Messages', icon: (a) => <MessagesIcon active={a} /> },
    { key: 'profile', label: 'Profile', icon: (a) => <ProfileIcon active={a} /> },
  ];

  const bottomNavItems: { key: Tab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    { key: 'home', label: 'Home', icon: (a) => <HomeIcon active={a} size={22} /> },
    { key: 'shorts', label: 'Shorts', icon: (a) => <ShortsIcon active={a} size={22} /> },
    { key: 'create', label: '', icon: () => <CreateIcon size={24} /> },
    { key: 'videos', label: 'Videos', icon: (a) => <VideosIcon active={a} size={22} /> },
    { key: 'profile', label: 'Profile', icon: (a) => <ProfileIcon active={a} size={22} /> },
  ];

  const handleSearchInputBlur = () => {
    setTimeout(() => {
      setHomeSuggestionOpen(false);
      if (activeTab === 'home') {
        if (!homeSearchInput && !homeSearchQuery) setSearchOpen(false);
      } else if (!activeSearchQuery) {
        setSearchOpen(false);
      }
    }, 120);
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (activeTab === 'home' && e.key === 'Enter') {
      e.preventDefault();
      if (homeSearchInput.trim()) commitHomeKeywordSearch(homeSearchInput);
    }
  };

  const homeSuggestionsDropdown = showHomeSuggestions ? (
    <div className="absolute top-[calc(100%+6px)] left-0 right-0 rounded-xl border border-alu-border bg-white shadow-[var(--alu-shadow-md)] py-1 z-[70]">
      {homeSuggestionLoading && (
        <div className="px-3 py-2 text-xs text-alu-text-tertiary">Searching...</div>
      )}
      {preferProfileResults && homePeopleSuggestions.length > 0 && (
        <div className="pb-1">
          {homePeopleSuggestions.map((person) => (
            <button
              key={person.userId}
              onMouseDown={() => {
                setHomeSuggestionOpen(false);
                setSearchOpen(false);
                handleViewUser(person.userId);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-alu-hover transition-colors"
            >
              {normalizeAvatarUrl(person.avatarUrl) && !brokenAvatars[`home-suggest:${person.userId}`] ? (
                <img
                  src={normalizeAvatarUrl(person.avatarUrl)}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover"
                  onError={() => setBrokenAvatars((prev) => ({ ...prev, [`home-suggest:${person.userId}`]: true }))}
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-alu-surface flex items-center justify-center text-[10px] font-bold text-alu-text-secondary">
                  {(person.displayName || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm text-alu-text">{person.displayName || 'User'}</span>
            </button>
          ))}
        </div>
      )}
      {homeKeywordSuggestions.map((keyword) => (
        <button
          key={`kw-${keyword}`}
          onMouseDown={() => commitHomeKeywordSearch(keyword)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-alu-hover transition-colors"
        >
          <SearchIcon size={14} />
          <span className="text-sm text-alu-text">{keyword}</span>
        </button>
      ))}
      {!preferProfileResults && homePeopleSuggestions.length > 0 && (
        <div className="border-t border-alu-border mt-1 pt-1">
          {homePeopleSuggestions.map((person) => (
            <button
              key={person.userId}
              onMouseDown={() => {
                setHomeSuggestionOpen(false);
                setSearchOpen(false);
                handleViewUser(person.userId);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-alu-hover transition-colors"
            >
              {normalizeAvatarUrl(person.avatarUrl) && !brokenAvatars[`home-suggest:${person.userId}`] ? (
                <img
                  src={normalizeAvatarUrl(person.avatarUrl)}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover"
                  onError={() => setBrokenAvatars((prev) => ({ ...prev, [`home-suggest:${person.userId}`]: true }))}
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-alu-surface flex items-center justify-center text-[10px] font-bold text-alu-text-secondary">
                  {(person.displayName || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm text-alu-text">{person.displayName || 'User'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-[var(--alu-bg)]">
      {/* ====== MOBILE TOP BAR (below md) ====== */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)]" style={{ height: 'var(--alu-header-height)' }}>
        <div className="flex items-center h-full px-3 gap-2">
          {/* Logo */}
          <button onClick={() => handleTabChange('home')} className="shrink-0 mr-1 flex items-center gap-1.5">
            <BrandWordmark small />
          </button>

          {/* Search + AI/Normal toggle — hidden on profile tab (like Instagram) */}
          {activeTab !== 'profile' ? (
            <>
              {/* Search (Instagram-style: icon only, expands on tap) */}
              {searchOpen ? (
                <div className="flex-1 relative animate-fade-in">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)]">
                    <SearchIcon size={16} />
                  </div>
                  <input
                    type="text"
                    placeholder="Search"
                    value={activeSearchQuery}
                    onChange={(e) => setActiveSearchQuery(e.target.value)}
                    onFocus={() => { if (activeTab === 'home') setHomeSuggestionOpen(true); }}
                    onKeyDown={handleSearchInputKeyDown}
                    autoFocus
                    onBlur={handleSearchInputBlur}
                    className="w-full h-9 pl-8 pr-8 rounded-full text-sm bg-[var(--alu-surface)] text-[var(--alu-text)] placeholder:text-[var(--alu-text-tertiary)] outline-none ring-2 ring-[var(--alu-primary-glow)]"
                  />
                  <button
                    onClick={() => {
                      clearSearchForActiveTab();
                      if (activeTab !== 'home') setSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)] hover:text-[var(--alu-text)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                  {homeSuggestionsDropdown}
                </div>
              ) : (
                <div className="flex-1" />
              )}

              {!searchOpen && (
                <button
                  onClick={() => {
                    setSearchOpen(true);
                    if (activeTab === 'home') setHomeSuggestionOpen(true);
                  }}
                  className="p-1.5 shrink-0 text-[var(--alu-text-secondary)] hover:text-[var(--alu-text)] transition-colors"
                >
                  <SearchIcon size={22} />
                </button>
              )}

              {/* AI/Normal toggle (compact, independent) */}
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={toggleAI}
                  className={`toggle-pill px-2.5 py-1 rounded-full text-xs font-medium ${showAI ? 'toggle-pill-active' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'}`}
                >
                  AI
                </button>
                <button
                  onClick={toggleNormal}
                  className={`toggle-pill px-2.5 py-1 rounded-full text-xs font-medium ${showNormal ? 'toggle-pill-active' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'}`}
                >
                  Normal
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1" />
          )}

          {/* Notifications + Messages */}
          <button
            onClick={() => handleTabChange('notifications')}
            className={`relative p-1.5 shrink-0 transition-colors ${activeTab === 'notifications' ? 'text-[var(--alu-primary)]' : 'text-[var(--alu-text-secondary)] hover:text-[var(--alu-text)]'}`}
          >
            <NotificationsIcon size={20} active={activeTab === 'notifications'} />
            {unreadNotifications > 0 && activeTab !== 'notifications' && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
          <button
            onClick={() => handleTabChange('messages')}
            className={`relative p-1.5 shrink-0 transition-colors ${activeTab === 'messages' ? 'text-[var(--alu-primary)]' : 'text-[var(--alu-text-secondary)] hover:text-[var(--alu-text)]'}`}
          >
            <MessagesIcon size={20} active={activeTab === 'messages'} />
            {unreadMessages > 0 && activeTab !== 'messages' && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
        </div>
      </header>

      {/* ====== DESKTOP SIDEBAR (md and above) ====== */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 z-40 flex-col border-r border-[var(--alu-border)]" style={{ width: 'var(--alu-sidebar-width)' }}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6">
          <button onClick={() => handleTabChange('home')} className="flex items-center gap-2">
            <BrandWordmark />
          </button>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-2 flex flex-col gap-0.5">
          {sidebarItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleTabChange(item.key)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left ${isActive
                    ? 'bg-[var(--alu-primary-glow)] text-[var(--alu-primary-dark)] font-semibold'
                    : 'text-[var(--alu-text-secondary)] hover:bg-[var(--alu-hover)] hover:text-[var(--alu-text)]'
                  }`}
              >
                <span className={`relative ${isActive ? 'text-[var(--alu-primary)]' : ''}`}>
                  {item.icon(isActive)}
                  {item.key === 'notifications' && unreadNotifications > 0 && activeTab !== 'notifications' && (
                    <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500" />
                  )}
                  {item.key === 'messages' && unreadMessages > 0 && activeTab !== 'messages' && (
                    <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </span>
                {item.label}
              </button>
            );
          })}

          {/* Create Button */}
          <button
            onClick={() => handleTabChange('create')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold mt-4 transition-all duration-200 w-full text-left text-white hover:opacity-90 create-btn-glow`}
            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
          >
            <CreateIcon size={20} />
            Create
          </button>
        </nav>

        {/* User at bottom */}
        <div className="p-4 border-t border-[var(--alu-border)]">
          {isSignedIn ? (
            <div className="flex items-center gap-3">
              <UserButton afterSignOutUrl="/" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--alu-text)] truncate">Your Account</p>
              </div>
            </div>
          ) : (
            <SignInButton mode="modal">
              <button
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
              >
                Sign In
              </button>
            </SignInButton>
          )}
        </div>
      </aside>

      {/* ====== MAIN CONTENT ====== */}
      <main
        className="md:ml-[var(--alu-sidebar-width)]"
        style={{
          paddingTop: 'var(--alu-header-height)',
          paddingBottom: 'calc(var(--alu-bottomnav-height) + 8px)',
        }}
      >
        {/* Desktop sticky header */}
        {showStickyHeader && (
          <div className="hidden md:flex sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)] items-center gap-3 px-6 h-14">
            {/* Desktop search: icon that expands */}
            {searchOpen ? (
              <div className="relative flex-1 max-w-md animate-fade-in">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)]">
                  <SearchIcon size={18} />
                </div>
                <input
                  type="text"
                  placeholder="Search"
                  value={activeSearchQuery}
                  onChange={(e) => setActiveSearchQuery(e.target.value)}
                  onFocus={() => { if (activeTab === 'home') setHomeSuggestionOpen(true); }}
                  onKeyDown={handleSearchInputKeyDown}
                  autoFocus
                  onBlur={handleSearchInputBlur}
                  className="w-full h-10 pl-10 pr-10 rounded-full text-sm bg-[var(--alu-surface)] text-[var(--alu-text)] placeholder:text-[var(--alu-text-tertiary)] outline-none ring-2 ring-[var(--alu-primary-glow)]"
                />
                <button
                  onClick={() => {
                    clearSearchForActiveTab();
                    if (activeTab !== 'home') setSearchOpen(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)] hover:text-[var(--alu-text)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
                {homeSuggestionsDropdown}
              </div>
            ) : (
              <button
                onClick={() => {
                  setSearchOpen(true);
                  if (activeTab === 'home') setHomeSuggestionOpen(true);
                }}
                className="flex items-center gap-2 h-10 px-4 rounded-full bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)] hover:bg-[var(--alu-hover)] transition-colors"
              >
                <SearchIcon size={18} />
                <span className="text-sm">Search</span>
              </button>
            )}
            <div className="flex gap-1.5 ml-auto">
              <button
                onClick={toggleAI}
                className={`toggle-pill px-4 py-1.5 rounded-full text-sm font-medium ${showAI ? 'toggle-pill-active' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'}`}
              >
                AI
              </button>
              <button
                onClick={toggleNormal}
                className={`toggle-pill px-4 py-1.5 rounded-full text-sm font-medium ${showNormal ? 'toggle-pill-active' : 'bg-[var(--alu-surface)] text-[var(--alu-text-tertiary)]'}`}
              >
                Normal
              </button>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className="w-full">
          {!isGuest || !activeTabNeedsAuth ? (
            <>
              {activeTab === 'home' && <HomeTab showAI={showAI} showNormal={showNormal} searchQuery={homeSearchQuery} onViewUser={handleViewUser} />}
              {activeTab === 'shorts' && <ShortsTab searchQuery={shortsSearchQuery} onViewUser={handleViewUser} />}
              {activeTab === 'videos' && <VideosTab searchQuery={videosSearchQuery} showAI={showAI} showNormal={showNormal} />}
              {activeTab === 'create' && <CreateTab />}
              {activeTab === 'profile' && (
                <ProfileTab
                  viewUserId={viewUserId}
                  onBack={() => setViewUserId(null)}
                  onViewUser={handleViewUser}
                  onMessageUser={handleMessageUser}
                />
              )}
              {activeTab === 'notifications' && <NotificationsTab onReadAll={() => setUnreadNotifications(0)} onViewUser={handleViewUser} />}
              {activeTab === 'messages' && (
                <MessagesTab
                  launchRequest={dmLaunchRequest}
                  onLaunchHandled={() => setDmLaunchRequest(null)}
                  onViewUser={handleViewUser}
                />
              )}
            </>
          ) : (
            <AuthRequiredCard
              title="Sign in required"
              subtitle="You can browse content without signing in, but creating and social actions need an account."
            />
          )}
        </div>
      </main>

      {/* ====== MOBILE BOTTOM NAV (below md) ====== */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-[var(--alu-border)] bottom-nav-safe" style={{ height: 'var(--alu-bottomnav-height)' }}>
        <div className="flex items-center justify-around h-full px-2">
          {bottomNavItems.map((item) => {
            const isActive = activeTab === item.key;
            const isCreate = item.key === 'create';

            if (isCreate) {
              return (
                <button
                  key={item.key}
                  onClick={() => handleTabChange('create')}
                  className="flex items-center justify-center w-11 h-11 rounded-xl text-white transition-all duration-200 active:scale-95 create-btn-glow"
                  style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                >
                  {item.icon(false)}
                </button>
              );
            }

            return (
              <button
                key={item.key}
                onClick={() => handleTabChange(item.key)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 transition-colors duration-200 ${isActive ? 'text-[var(--alu-primary)]' : 'text-[var(--alu-text-tertiary)]'
                  }`}
              >
                {item.icon(isActive)}
                <span className={`text-[10px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

