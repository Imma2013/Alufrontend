const express = require('express');
const { getObjectByPublicUrl } = require('../services/storj');

const router = express.Router();

// GET /media/proxy?url=<storj-public-url>
// Streams Storj-backed assets through backend so private Storj links still render.
router.get('/proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Missing media url' });
    }

    const object = await getObjectByPublicUrl(rawUrl);
    if (!object || !object.Body) {
      return res.status(404).json({ error: 'Media not found' });
    }

    if (object.ContentType) res.setHeader('Content-Type', object.ContentType);
    if (typeof object.ContentLength === 'number') res.setHeader('Content-Length', String(object.ContentLength));
    res.setHeader('Cache-Control', object.CacheControl || 'public, max-age=3600');
    if (object.ETag) res.setHeader('ETag', object.ETag);
    if (object.LastModified) res.setHeader('Last-Modified', new Date(object.LastModified).toUTCString());

    object.Body.pipe(res);
  } catch (error) {
    console.error('Media proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy media' });
  }
});

module.exports = router;
