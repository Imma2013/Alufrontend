import { BACKEND_URL } from '@/app/lib/backend';

type TokenProvider = () => Promise<string | null>;

function normalizeHandle(raw: string): { normalized: string; bskyHandle: string } {
  const normalized = String(raw || '').trim().toLowerCase().replace(/^@+/, '');
  const bskyHandle = normalized.includes('.') ? normalized : `${normalized}.bsky.social`;
  return { normalized, bskyHandle };
}

export function getBlueskyProfileUrl(handle: string): string {
  const { normalized, bskyHandle } = normalizeHandle(handle);
  if (!normalized) return '';
  return `https://bsky.app/profile/${bskyHandle}`;
}

export async function resolveMentionUserId(handle: string, getToken: TokenProvider): Promise<string> {
  const { normalized, bskyHandle } = normalizeHandle(handle);
  if (!normalized) return '';

  try {
    const token = await getToken();
    const requestInit: RequestInit = token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {};

    const resolveRes = await fetch(`${BACKEND_URL}/users/resolve-handle?handle=${encodeURIComponent(normalized)}`, {
      ...requestInit,
    });
    if (resolveRes.ok) {
      const resolved = await resolveRes.json().catch(() => ({}));
      const targetId = String(resolved?.user?.userId || '').trim();
      if (targetId) return targetId;
    }

    const searchRes = await fetch(`${BACKEND_URL}/users/search?q=${encodeURIComponent(normalized)}`, {
      ...requestInit,
    });
    if (!searchRes.ok) return '';
    const data = await searchRes.json();
    const users = Array.isArray(data.users) ? data.users : [];
    const exact = users.find((u: { displayName?: string; userId?: string }) => {
      const displayName = String(u.displayName || '').trim().toLowerCase();
      const userId = String(u.userId || '').trim().toLowerCase();
      return displayName === normalized || userId === normalized || userId === bskyHandle;
    });
    const target = exact || users[0];
    return String(target?.userId || '').trim();
  } catch {
    return '';
  }
}
