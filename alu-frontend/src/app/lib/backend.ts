export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

if (!BACKEND_URL) {
  throw new Error('Missing NEXT_PUBLIC_BACKEND_URL. Set it in Vercel environment variables.');
}

export function ensureBackendUrlNotFrontend(currentOrigin?: string) {
  if (!currentOrigin) return;
  try {
    const backend = new URL(BACKEND_URL);
    const frontend = new URL(currentOrigin);
    if (backend.host === frontend.host) {
      throw new Error('NEXT_PUBLIC_BACKEND_URL points to the frontend domain. Set it to your Render backend URL.');
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Invalid NEXT_PUBLIC_BACKEND_URL. Use full URL like https://your-backend.onrender.com');
  }
}
