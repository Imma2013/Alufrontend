const FALLBACK_SITE_URL = 'https://alu-teal-pi.vercel.app';

function normalizeBase(url: string) {
  return url.replace(/\/+$/, '');
}

export function getAppBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeBase(window.location.origin);
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL || '';
  return normalizeBase(configured || FALLBACK_SITE_URL);
}

export function getPostShareUrl(postId: string) {
  return `${getAppBaseUrl()}/post/${postId}`;
}

export function getProfileShareUrl(userId: string) {
  return `${getAppBaseUrl()}/profile/${userId}`;
}

export function getWatchShareUrl(postId: string) {
  return `${getAppBaseUrl()}/watch/${postId}`;
}

export function getCanonicalUrl(path = '/') {
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBaseUrl()}${cleaned}`;
}
