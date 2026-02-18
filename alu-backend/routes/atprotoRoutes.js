const express = require('express');
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
