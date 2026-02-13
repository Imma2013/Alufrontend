'use client';

import { useState, useEffect } from 'react';
import { UserButton, useUser, SignInButton } from '@clerk/nextjs';
import { initDb } from './db';
import {
  HomeIcon,
  ShortsIcon,
  VideosIcon,
  NotificationsIcon,
  ProfileIcon,
  CreateIcon,
  SearchIcon,
  AluLogo,
} from './components/icons';
import HomeTab from './components/tabs/HomeTab';
import ShortsTab from './components/tabs/ShortsTab';
import VideosTab from './components/tabs/VideosTab';
import CreateTab from './components/tabs/CreateTab';
import ProfileTab from './components/tabs/ProfileTab';
import NotificationsTab from './components/tabs/NotificationsTab';

type Tab = 'home' | 'shorts' | 'videos' | 'create' | 'profile' | 'notifications';

const TABS_WITH_HEADER: Tab[] = ['home', 'shorts', 'videos'];

export default function App() {
  const { isSignedIn, isLoaded } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [viewUserId, setViewUserId] = useState<string | null>(null);

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

  const [showAI, setShowAI] = useState(true);
  const [showNormal, setShowNormal] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [shortsSearchQuery, setShortsSearchQuery] = useState('');
  const [videosSearchQuery, setVideosSearchQuery] = useState('');

  const activeSearchQuery =
    activeTab === 'home'
      ? homeSearchQuery
      : activeTab === 'shorts'
        ? shortsSearchQuery
        : activeTab === 'videos'
          ? videosSearchQuery
          : '';

  const setActiveSearchQuery = (value: string) => {
    if (activeTab === 'home') setHomeSearchQuery(value);
    if (activeTab === 'shorts') setShortsSearchQuery(value);
    if (activeTab === 'videos') setVideosSearchQuery(value);
  };

  // Sign-in screen for logged-out users
  if (isLoaded && !isSignedIn) {
    return (
      <div className="min-h-screen bg-[var(--alu-bg)] flex items-center justify-center">
        <div className="text-center px-6 max-w-sm mx-auto animate-fade-in">
          <div className="flex justify-center mb-6">
            <AluLogo size={40} />
          </div>
          <h1 className="text-2xl font-bold text-alu-text mb-2">Welcome to Alu</h1>
          <p className="text-sm text-alu-text-secondary mb-8">The next generation social network powered by AI</p>
          <SignInButton mode="modal">
            <button
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
            >
              Sign In
            </button>
          </SignInButton>
          <p className="text-xs text-alu-text-tertiary mt-4">Create, share, and discover AI-powered content</p>
        </div>
      </div>
    );
  }

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
    { key: 'profile', label: 'Profile', icon: (a) => <ProfileIcon active={a} /> },
  ];

  const bottomNavItems: { key: Tab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    { key: 'home', label: 'Home', icon: (a) => <HomeIcon active={a} size={22} /> },
    { key: 'shorts', label: 'Shorts', icon: (a) => <ShortsIcon active={a} size={22} /> },
    { key: 'create', label: '', icon: () => <CreateIcon size={24} /> },
    { key: 'videos', label: 'Videos', icon: (a) => <VideosIcon active={a} size={22} /> },
    { key: 'profile', label: 'Profile', icon: (a) => <ProfileIcon active={a} size={22} /> },
  ];

  return (
    <div className="min-h-screen bg-[var(--alu-bg)]">
      {/* ====== MOBILE TOP BAR (below md) ====== */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)]" style={{ height: 'var(--alu-header-height)' }}>
        <div className="flex items-center h-full px-3 gap-2">
          {/* Logo */}
          <button onClick={() => handleTabChange('home')} className="shrink-0 mr-1">
            <AluLogo size={22} />
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
                    autoFocus
                    onBlur={() => { if (!activeSearchQuery) setSearchOpen(false); }}
                    className="w-full h-9 pl-8 pr-8 rounded-full text-sm bg-[var(--alu-surface)] text-[var(--alu-text)] placeholder:text-[var(--alu-text-tertiary)] outline-none ring-2 ring-[var(--alu-primary-glow)]"
                  />
                  <button
                    onClick={() => { setSearchOpen(false); setActiveSearchQuery(''); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)] hover:text-[var(--alu-text)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ) : (
                <div className="flex-1" />
              )}

              {!searchOpen && (
                <button
                  onClick={() => setSearchOpen(true)}
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
          </button>
        </div>
      </header>

      {/* ====== DESKTOP SIDEBAR (md and above) ====== */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 z-40 flex-col border-r border-[var(--alu-border)]" style={{ width: 'var(--alu-sidebar-width)' }}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6">
          <button onClick={() => handleTabChange('home')}>
            <AluLogo size={28} />
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
                <span className={isActive ? 'text-[var(--alu-primary)]' : ''}>{item.icon(isActive)}</span>
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
          <div className="flex items-center gap-3">
            <UserButton afterSignOutUrl="/" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--alu-text)] truncate">Your Account</p>
            </div>
          </div>
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
                  autoFocus
                  onBlur={() => { if (!activeSearchQuery) setSearchOpen(false); }}
                  className="w-full h-10 pl-10 pr-10 rounded-full text-sm bg-[var(--alu-surface)] text-[var(--alu-text)] placeholder:text-[var(--alu-text-tertiary)] outline-none ring-2 ring-[var(--alu-primary-glow)]"
                />
                <button
                  onClick={() => { setSearchOpen(false); setActiveSearchQuery(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--alu-text-tertiary)] hover:text-[var(--alu-text)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
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
          {activeTab === 'home' && <HomeTab showAI={showAI} showNormal={showNormal} searchQuery={homeSearchQuery} onViewUser={handleViewUser} />}
          {activeTab === 'shorts' && <ShortsTab searchQuery={shortsSearchQuery} />}
          {activeTab === 'videos' && <VideosTab searchQuery={videosSearchQuery} />}
          {activeTab === 'create' && <CreateTab />}
          {activeTab === 'profile' && <ProfileTab viewUserId={viewUserId} onBack={() => setViewUserId(null)} onViewUser={handleViewUser} />}
          {activeTab === 'notifications' && <NotificationsTab />}
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
