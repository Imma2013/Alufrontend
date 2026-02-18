'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type StoredUser = {
  did: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio?: string;
};

type PublicUser = {
  id: string;
  username: string;
  fullName: string;
  firstName: string;
  imageUrl: string;
  unsafeMetadata: { bio?: string };
  update: (updates: { firstName?: string; unsafeMetadata?: { bio?: string } }) => Promise<void>;
  setProfileImage: ({ file }: { file: File }) => Promise<void>;
};

type AuthContextValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  token: string | null;
  user: PublicUser | null;
  userId: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  openSignIn: () => void;
  closeSignIn: () => void;
  signInWithAtproto: (identifier: string, password: string) => Promise<void>;
};

const TOKEN_KEY = 'alu_at_token';
const USER_KEY = 'alu_at_user';
const AuthContext = createContext<AuthContextValue | null>(null);

function toPublicUser(raw: StoredUser, token: string, refresh: () => Promise<void>): PublicUser {
  return {
    id: raw.did,
    username: raw.handle,
    fullName: raw.displayName || raw.handle,
    firstName: raw.displayName || raw.handle,
    imageUrl: raw.avatarUrl || '',
    unsafeMetadata: { bio: raw.bio || '' },
    update: async (updates) => {
      const nextDisplayName = String(updates.firstName || raw.displayName || '').trim();
      const nextBio = String(updates.unsafeMetadata?.bio || raw.bio || '').trim();
      await fetch(`${BACKEND_URL}/users/me/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: nextDisplayName, bio: nextBio }),
      });
      localStorage.setItem(
        USER_KEY,
        JSON.stringify({ ...raw, displayName: nextDisplayName || raw.displayName, bio: nextBio })
      );
      await refresh();
    },
    setProfileImage: async ({ file }) => {
      const form = new FormData();
      form.append('avatar', file);
      const res = await fetch(`${BACKEND_URL}/users/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Failed to upload profile image');
      const data = await res.json();
      const avatarUrl = String(data?.avatarUrl || '').trim();
      localStorage.setItem(USER_KEY, JSON.stringify({ ...raw, avatarUrl }));
      await refresh();
    },
  };
}

function AuthProviderInner({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [storedUser, setStoredUser] = useState<StoredUser | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInError, setSignInError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const refreshFromStorage = useCallback(async () => {
    const nextToken = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    setToken(nextToken || null);
    setStoredUser(rawUser ? (JSON.parse(rawUser) as StoredUser) : null);
  }, []);

  useEffect(() => {
    void refreshFromStorage().finally(() => setIsLoaded(true));
  }, [refreshFromStorage]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setStoredUser(null);
    setShowSignIn(false);
  }, []);

  const signInWithAtproto = useCallback(async (id: string, pass: string) => {
    setSubmitting(true);
    setSignInError('');
    try {
      const res = await fetch(`${BACKEND_URL}/atproto/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password: pass }),
      });
      const data = await res.json();
      if (!res.ok || !data?.token) {
        throw new Error(data?.error || 'Sign-in failed');
      }
      const nextToken = String(data.token);
      const user = data.user || {};
      const nextUser: StoredUser = {
        did: String(user.did || ''),
        handle: String(user.handle || id),
        displayName: String(user.displayName || user.handle || id),
        avatarUrl: String(user.avatarUrl || ''),
        bio: '',
      };
      localStorage.setItem(TOKEN_KEY, nextToken);
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      setToken(nextToken);
      setStoredUser(nextUser);
      setShowSignIn(false);
      setPassword('');
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }, []);

  const ctx = useMemo<AuthContextValue>(() => {
    const user = token && storedUser ? toPublicUser(storedUser, token, refreshFromStorage) : null;
    return {
      isLoaded,
      isSignedIn: !!token && !!storedUser,
      token,
      user,
      userId: user?.id || null,
      getToken: async () => token,
      signOut,
      openSignIn: () => setShowSignIn(true),
      closeSignIn: () => setShowSignIn(false),
      signInWithAtproto,
    };
  }, [isLoaded, token, storedUser, signOut, signInWithAtproto, refreshFromStorage]);

  return (
    <AuthContext.Provider value={ctx}>
      {children}
      {showSignIn && (
        <div className="fixed inset-0 z-[300] bg-black/55 flex items-center justify-center p-4" onClick={() => setShowSignIn(false)}>
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-alu-text mb-3">Sign in with AT Protocol</h3>
            <p className="text-xs text-alu-text-tertiary mb-3">Use your handle/email and app password.</p>
            <input
              className="w-full h-10 px-3 rounded-xl bg-alu-surface text-sm mb-2 outline-none"
              placeholder="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <input
              className="w-full h-10 px-3 rounded-xl bg-alu-surface text-sm mb-2 outline-none"
              placeholder="app password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {signInError && <p className="text-xs text-red-500 mb-2">{signInError}</p>}
            <div className="flex gap-2 mt-3">
              <button className="flex-1 h-10 rounded-xl bg-alu-surface text-sm font-semibold" onClick={() => setShowSignIn(false)}>
                Cancel
              </button>
              <button
                className="flex-1 h-10 rounded-xl text-white text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
                disabled={submitting}
                onClick={() => signInWithAtproto(identifier.trim(), password)}
              >
                {submitting ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <AuthProviderInner>{children}</AuthProviderInner>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within ClerkProvider');
  return {
    getToken: ctx.getToken,
    isSignedIn: ctx.isSignedIn,
    userId: ctx.userId,
  };
}

export function useUser() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useUser must be used within ClerkProvider');
  return {
    isLoaded: ctx.isLoaded,
    isSignedIn: ctx.isSignedIn,
    user: ctx.user,
  };
}

export function useClerk() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useClerk must be used within ClerkProvider');
  return {
    signOut: ctx.signOut,
  };
}

type ClickableChildProps = {
  onClick?: React.MouseEventHandler<HTMLElement>;
};

export function SignInButton({ children }: { children: React.ReactElement; mode?: string }) {
  const ctx = useContext(AuthContext);
  if (!ctx) return children;
  if (!React.isValidElement<ClickableChildProps>(children)) return children;

  const existingOnClick = children.props.onClick;
  return React.cloneElement<ClickableChildProps>(children, {
    onClick: (e) => {
      e.preventDefault();
      existingOnClick?.(e);
      ctx.openSignIn();
    },
  });
}

export function UserButton() {
  const ctx = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  if (!ctx || !ctx.user) return null;

  const letter = (ctx.user.fullName || ctx.user.username || 'U')[0]?.toUpperCase() || 'U';

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="w-8 h-8 rounded-full bg-alu-surface text-sm font-bold text-alu-text">
        {letter}
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 bg-white border border-alu-border rounded-lg shadow-md p-1 min-w-[120px]">
          <button
            className="w-full text-left text-xs px-2 py-1.5 hover:bg-alu-surface rounded"
            onClick={async () => {
              await ctx.signOut();
              setOpen(false);
            }}
          >
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
