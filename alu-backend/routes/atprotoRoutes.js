const express = require('express');
const {
  bootLexicons,
  listLexiconIds,
  getLexiconDoc,
  assertValidRecord,
} = require('../services/atprotoLexicons');
const {
  isAtprotoConfigured,
  atprotoServiceUrl,
} = require('../services/atprotoClient');

const router = express.Router();

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

