import { BACKEND_URL } from '@/app/lib/backend';

function hostFor(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function isStorjHost(host: string): boolean {
  return host.includes('storj') || host.includes('tardigrade');
}

export function resolveMediaUrl(url?: string | null): string {
  const value = String(url || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;
  const host = hostFor(value);
  if (!isStorjHost(host)) return value;
  return `${BACKEND_URL}/media/proxy?url=${encodeURIComponent(value)}`;
}

export function resolveMediaList(urls?: string[] | null): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => resolveMediaUrl(u)).filter(Boolean);
}
