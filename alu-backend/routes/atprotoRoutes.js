const express = require('express');
const { AtpAgent } = require('@atproto/api');
const clerkAuth = require('../middleware/clerkAuth');
const { createAtSessionToken } = require('../middleware/clerkAuth');
const {
  bootLexicons,
  listLexiconIds,
  getLexiconDoc,
  assertValidRecord,
} = require('../services/atprotoLexicons');
const {
  isAtprotoConfigured,
  atprotoServiceUrl,
  createUserAgent,
  getActorProfile,
  publishLexiconSchemas,
} = require('../services/atprotoClient');
const { syncAtBridge } = require('../services/atprotoBridge');
const { User } = require('../config/db');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    const password = String(req.body?.password || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'identifier and password are required' });
    }

    const { agent, did } = await createUserAgent(identifier, password);
    const profile = await getActorProfile(agent, did || identifier);
    const token = createAtSessionToken({
      did: did || profile.did || '',
      handle: profile.handle || identifier,
      profile,
    });

    return res.json({
      ok: true,
      token,
      user: {
        did: did || profile.did || '',
        handle: profile.handle || identifier,
        displayName: profile.displayName || profile.handle || identifier,
        avatarUrl: profile.avatar || '',
      },
    });
  } catch (err) {
    return res.status(401).json({ ok: false, error: err?.message || 'AT login failed' });
  }
});

router.get('/auth/me', clerkAuth, async (req, res) => {
  const auth = req.auth || {};
  return res.json({
    ok: true,
    provider: req.authProvider || 'unknown',
    user: {
      did: auth.did || auth.sub || '',
      handle: auth.handle || auth.username || '',
      displayName: auth.displayName || auth.username || '',
      avatarUrl: auth.picture || auth.image_url || '',
    },
  });
});

router.get('/bridge/status', clerkAuth, async (req, res) => {
  const auth = req.auth || {};
  const actorDid = String(auth.did || auth.sub || '').trim();
  const profile = actorDid
    ? await User.findOne(
        { userId: actorDid },
        { atBridgeLastSyncedAt: 1, atBridgeLastStats: 1, _id: 0 }
      )
    : null;
  return res.json({
    ok: true,
    actorDid,
    actorHandle: String(auth.handle || auth.username || '').trim(),
    lastSyncedAt: profile?.atBridgeLastSyncedAt || null,
    lastStats: profile?.atBridgeLastStats || null,
  });
});

router.post('/bridge/sync', clerkAuth, async (req, res) => {
  try {
    const auth = req.auth || {};
    const actorDid = String(auth.did || auth.sub || '').trim();
    const actorHandle = String(auth.handle || auth.username || '').trim();
    if (!actorDid) {
      return res.status(400).json({ ok: false, error: 'Missing actor DID in auth token.' });
    }

    const importFollows = req.body?.importFollows !== false;
    const importOwnPosts = req.body?.importOwnPosts !== false;
    const importFollowingPosts = req.body?.importFollowingPosts === true;
    const maxFollows = Number(req.body?.maxFollows || 100);
    const maxPostsPerActor = Number(req.body?.maxPostsPerActor || 10);

    const stats = await syncAtBridge({
      actorDid,
      actorHandle,
      importFollows,
      importOwnPosts,
      importFollowingPosts,
      maxFollows: Math.min(Math.max(maxFollows, 1), 300),
      maxPostsPerActor: Math.min(Math.max(maxPostsPerActor, 1), 30),
    });
    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Bridge sync failed' });
  }
});

router.post('/bridge/profile-sync', clerkAuth, async (req, res) => {
  try {
    const auth = req.auth || {};
    const actorDid = String(auth.did || auth.sub || '').trim();
    const actorHandle = String(auth.handle || auth.username || '').trim();
    const actor = actorDid || actorHandle;
    if (!actor) {
      return res.status(400).json({ ok: false, error: 'Missing actor identity in auth token.' });
    }

    const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
    const profileRes = await agent.app.bsky.actor.getProfile({ actor });
    const profile = profileRes?.data || {};

    const displayName = String(profile.displayName || profile.handle || actorHandle || actorDid).trim();
    const blueskyAvatarUrl = String(profile.avatar || '').trim();
    const aliases = [actorDid, actorHandle, profile.did, profile.handle].map((v) => String(v || '').trim()).filter(Boolean);

    const existing = await User.findOne(
      { userId: actorDid },
      { avatarPreference: 1, avatarUrl: 1, manualAvatarUrl: 1, _id: 0 }
    );
    const shouldApplyAvatar =
      !!blueskyAvatarUrl &&
      (
        existing?.avatarPreference === 'bluesky' ||
        !String(existing?.avatarUrl || '').trim()
      );

    const update = {
      $setOnInsert: { userId: actorDid },
      $addToSet: aliases.length > 0 ? { aliases: { $each: aliases } } : undefined,
      $set: {
        displayName,
        ...(blueskyAvatarUrl ? { blueskyAvatarUrl } : {}),
        ...(shouldApplyAvatar ? { avatarUrl: blueskyAvatarUrl } : {}),
      },
    };
    if (!update.$addToSet) delete update.$addToSet;

    const user = await User.findOneAndUpdate(
      { userId: actorDid },
      update,
      {
        upsert: true,
        new: true,
        projection: { userId: 1, displayName: 1, avatarUrl: 1, blueskyAvatarUrl: 1, avatarPreference: 1, _id: 0 },
      }
    );

    return res.json({
      ok: true,
      profile: {
        did: String(profile.did || actorDid),
        handle: String(profile.handle || actorHandle),
        displayName,
        avatarUrl: blueskyAvatarUrl,
      },
      user,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Profile sync failed' });
  }
});

router.post('/publish-lexicons', async (req, res) => {
  try {
    const expected = String(process.env.ATPROTO_ADMIN_KEY || '').trim();
    const provided = String(req.headers['x-admin-key'] || '').trim();
    if (!expected) {
      return res.status(400).json({ error: 'ATPROTO_ADMIN_KEY is not configured' });
    }
    if (!provided || provided !== expected) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    const published = await publishLexiconSchemas();
    return res.json({ ok: true, published });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Lexicon publish failed' });
  }
});

router.get('/health', (req, res) => {
  try {
    const ids = listLexiconIds();
    return res.json({
      ok: true,
      configured: isAtprotoConfigured(),
      service: atprotoServiceUrl(),
      lexicons: ids,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Failed to load AT Proto lexicons',
    });
  }
});

router.get('/lexicons', (req, res) => {
  try {
    const ids = listLexiconIds();
    return res.json({ lexicons: ids });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to list lexicons' });
  }
});

router.get('/lexicons/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const doc = getLexiconDoc(id);
    if (!doc) return res.status(404).json({ error: 'Lexicon not found' });
    return res.json(doc);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to read lexicon' });
  }
});

router.post('/validate-record', (req, res) => {
  try {
    const collection = String(req.body?.collection || '').trim();
    const record = req.body?.record;
    if (!collection) {
      return res.status(400).json({ error: 'collection is required' });
    }
    const validated = assertValidRecord(collection, record);
    return res.json({ ok: true, record: validated });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || 'Record validation failed' });
  }
});

bootLexicons();

module.exports = router;
