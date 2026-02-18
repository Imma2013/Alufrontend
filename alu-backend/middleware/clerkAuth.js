const crypto = require('crypto');
const { Clerk } = require('@clerk/clerk-sdk-node');
const { User } = require('../config/db');

const clerkSecret = String(process.env.CLERK_SECRET_KEY || '').trim();
const clerk = clerkSecret ? Clerk({ secretKey: clerkSecret }) : null;
const sessionSecret = String(process.env.AUTH_TOKEN_SECRET || '').trim();

const base64UrlEncode = (value) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const base64UrlDecode = (value) => {
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = input + '='.repeat((4 - (input.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
};

const signPayload = (payload) => {
  if (!sessionSecret) throw new Error('AUTH_TOKEN_SECRET is required');
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(encoded)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${encoded}.${signature}`;
};

const verifySignedToken = (token) => {
  if (!sessionSecret) throw new Error('AUTH_TOKEN_SECRET is required');
  const [encoded, providedSignature] = String(token || '').split('.');
  if (!encoded || !providedSignature) throw new Error('Invalid token format');
  const expected = crypto
    .createHmac('sha256', sessionSecret)
    .update(encoded)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (providedSignature !== expected) throw new Error('Invalid token signature');
  const payload = JSON.parse(base64UrlDecode(encoded));
  if (!payload?.sub) throw new Error('Missing token subject');
  if (payload.exp && Date.now() > Number(payload.exp)) throw new Error('Token expired');
  return payload;
};

const toDisplayName = (claims) => {
  const first = String(claims?.first_name || '').trim();
  const last = String(claims?.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const username = String(claims?.username || claims?.preferred_username || '').trim();
  if (username) return username;
  const primaryEmail = String(claims?.email || claims?.email_address || '').trim();
  if (primaryEmail) return primaryEmail;
  const emails = Array.isArray(claims?.email_addresses) ? claims.email_addresses : [];
  const firstEmailObj = emails[0];
  if (typeof firstEmailObj === 'string') return String(firstEmailObj || '').trim();
  return String(firstEmailObj?.email_address || '').trim();
};

const toAvatarUrl = (claims) => {
  const candidates = [
    claims?.image_url,
    claims?.picture,
    claims?.imageUrl,
    claims?.avatar_url,
    claims?.profile_image_url,
  ];
  for (const value of candidates) {
    const url = String(value || '').trim();
    if (url) return url;
  }
  return '';
};

const toAliasCandidates = (claims) => {
  const aliases = new Set();
  const add = (value) => {
    const v = String(value || '').trim();
    if (v) aliases.add(v);
  };

  add(claims?.sub);
  add(claims?.username);
  add(claims?.preferred_username);
  add(claims?.userId);
  add(claims?.user_id);
  return Array.from(aliases);
};

const toDisplayNameFromAt = (profile = {}, identifier = '') => {
  const candidates = [profile.displayName, profile.handle, identifier];
  for (const value of candidates) {
    const v = String(value || '').trim();
    if (v) return v;
  }
  return '';
};

const toAvatarUrlFromAt = (profile = {}) => String(profile.avatar || '').trim();

async function syncUserDirectory(claims) {
  const userId = claims.sub;
  if (!userId) return;
  const displayName = toDisplayName(claims);
  const avatarUrl = toAvatarUrl(claims);
  const aliases = toAliasCandidates(claims);
  const setFields = {};
  if (displayName) setFields.displayName = displayName;
  if (avatarUrl) setFields.avatarUrl = avatarUrl;

  await User.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: { userId, aliases: [userId] },
      ...(aliases.length > 0 ? { $addToSet: { aliases: { $each: aliases } } } : {}),
      ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}),
    },
    { upsert: true, new: true }
  );
}

const verifyClerkToken = async (token) => {
  if (!clerk) throw new Error('Clerk is not configured');
  const claims = await clerk.verifyToken(token);
  if (!claims) throw new Error('Invalid Clerk token');
  return claims;
};

const verifyAtSessionToken = async (token) => verifySignedToken(token);

const clerkAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Bearer token missing' });
  }

  try {
    let claims = null;
    let authProvider = '';

    try {
      claims = await verifyAtSessionToken(token);
      authProvider = 'atproto';
    } catch {
      claims = await verifyClerkToken(token);
      authProvider = 'clerk';
    }
    req.auth = claims;
    req.authProvider = authProvider;

    try {
      await syncUserDirectory(claims);
    } catch (syncErr) {
      console.warn('User sync on auth failed:', syncErr.message);
    }

    next();
  } catch (error) {
    console.error('Clerk verification error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const createAtSessionToken = ({ did, handle, profile = {} }) => {
  const now = Date.now();
  const payload = {
    sub: String(did || '').trim(),
    did: String(did || '').trim(),
    handle: String(handle || '').trim(),
    username: String(handle || '').trim(),
    displayName: toDisplayNameFromAt(profile, handle),
    picture: toAvatarUrlFromAt(profile),
    provider: 'atproto',
    iat: now,
    exp: now + 1000 * 60 * 60 * 24 * 30, // 30 days
  };
  return signPayload(payload);
};

module.exports = clerkAuth;
module.exports.createAtSessionToken = createAtSessionToken;
module.exports.verifyAtSessionToken = verifyAtSessionToken;
