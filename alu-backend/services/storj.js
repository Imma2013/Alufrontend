const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const axios = require('axios');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const ffmpegPath = require('ffmpeg-static');

const ENDPOINT = process.env.STORJ_S3_ENDPOINT;
const REGION = process.env.STORJ_S3_REGION || 'us-east-1';
const ACCESS_KEY = process.env.STORJ_ACCESS_KEY;
const SECRET_KEY = process.env.STORJ_SECRET_KEY;
const BUCKET = process.env.STORJ_BUCKET;
const PUBLIC_BASE = (process.env.STORJ_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
};

let s3Client = null;

function assertStorjConfig() {
  const missing = [];
  if (!ENDPOINT) missing.push('STORJ_S3_ENDPOINT');
  if (!ACCESS_KEY) missing.push('STORJ_ACCESS_KEY');
  if (!SECRET_KEY) missing.push('STORJ_SECRET_KEY');
  if (!BUCKET) missing.push('STORJ_BUCKET');
  if (!PUBLIC_BASE) missing.push('STORJ_PUBLIC_BASE_URL');
  if (missing.length > 0) {
    throw new Error(`Missing Storj config: ${missing.join(', ')}`);
  }
}

function getS3() {
  assertStorjConfig();
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
  return s3Client;
}

function sanitizeSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomId() {
  return crypto.randomBytes(6).toString('hex');
}

function extFromMime(mimeType = '', fallback = 'bin') {
  return EXT_BY_MIME[String(mimeType || '').toLowerCase()] || fallback;
}

function buildKey({ folder = 'alu-uploads', userId = 'anon', prefix = 'asset', ext = 'bin' }) {
  const safeFolder = sanitizeSegment(folder) || 'alu-uploads';
  const safeUser = sanitizeSegment(userId) || 'anon';
  const safePrefix = sanitizeSegment(prefix) || 'asset';
  return `${safeFolder}/${safeUser}_${Date.now()}_${safePrefix}_${randomId()}.${ext}`;
}

function publicUrlForKey(key) {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${PUBLIC_BASE}/${encoded}`;
}

async function uploadBuffer({ buffer, contentType, key, cacheControl }) {
  const client = getS3();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: cacheControl || 'public, max-age=31536000, immutable',
    })
  );
  return publicUrlForKey(key);
}

async function uploadFile(filePath, { contentType, folder, userId, prefix, ext }) {
  const data = await fs.promises.readFile(filePath);
  const key = buildKey({ folder, userId, prefix, ext });
  const url = await uploadBuffer({ buffer: data, contentType, key });
  return { url, key };
}

async function uploadRemoteFile(remoteUrl, { contentTypeFallback, folder, userId, prefix, extFallback }) {
  const resp = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 120000 });
  const contentType = resp.headers['content-type'] || contentTypeFallback || 'application/octet-stream';
  const ext = extFromMime(contentType, extFallback || 'bin');
  const key = buildKey({ folder, userId, prefix, ext });
  const url = await uploadBuffer({ buffer: Buffer.from(resp.data), contentType, key });
  return { url, key, contentType };
}

function makeTmpPath(ext) {
  return path.join(os.tmpdir(), `alu-storj-${Date.now()}-${randomId()}.${ext}`);
}

function createVideoThumbnail(videoPath) {
  if (!ffmpegPath) return null;
  const thumbPath = makeTmpPath('jpg');
  try {
    const cmd = `"${ffmpegPath}" -y -ss 00:00:01 -i "${videoPath}" -vframes 1 -vf "scale=640:-1" "${thumbPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    const data = fs.readFileSync(thumbPath);
    return data;
  } catch {
    return null;
  } finally {
    try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch {}
  }
}

async function uploadVideoFileWithThumbnail(filePath, { folder, userId, prefix = 'video', mimeType = 'video/mp4' }) {
  const ext = path.extname(filePath).replace('.', '') || extFromMime(mimeType, 'mp4');
  const video = await uploadFile(filePath, { contentType: mimeType, folder, userId, prefix, ext });

  const thumbBuffer = createVideoThumbnail(filePath);
  if (!thumbBuffer) {
    return { videoUrl: video.url, thumbnailUrl: null };
  }

  const thumbKey = buildKey({ folder: `${folder}-thumbs`, userId, prefix: `${prefix}-thumb`, ext: 'jpg' });
  const thumbnailUrl = await uploadBuffer({
    buffer: thumbBuffer,
    contentType: 'image/jpeg',
    key: thumbKey,
    cacheControl: 'public, max-age=604800',
  });

  return { videoUrl: video.url, thumbnailUrl };
}

async function uploadVideoBufferWithThumbnail(buffer, { folder, userId, prefix = 'video', mimeType = 'video/mp4' }) {
  const ext = extFromMime(mimeType, 'mp4');
  const tmpVideo = makeTmpPath(ext);
  try {
    await fs.promises.writeFile(tmpVideo, buffer);
    return await uploadVideoFileWithThumbnail(tmpVideo, { folder, userId, prefix, mimeType });
  } finally {
    try { if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo); } catch {}
  }
}

async function uploadRemoteVideoWithThumbnail(remoteUrl, { folder, userId, prefix = 'video' }) {
  const resp = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 180000 });
  const mimeType = resp.headers['content-type'] || 'video/mp4';
  return uploadVideoBufferWithThumbnail(Buffer.from(resp.data), { folder, userId, prefix, mimeType });
}

function keyFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('?')[0];

  if (PUBLIC_BASE && clean.startsWith(`${PUBLIC_BASE}/`)) {
    return decodeURIComponent(clean.slice(PUBLIC_BASE.length + 1));
  }

  if (ENDPOINT && BUCKET) {
    const endpointPrefix = `${ENDPOINT.replace(/\/+$/, '')}/${BUCKET}/`;
    if (clean.startsWith(endpointPrefix)) {
      return decodeURIComponent(clean.slice(endpointPrefix.length));
    }
  }

  return null;
}

async function getObjectByPublicUrl(url) {
  const key = keyFromPublicUrl(url);
  if (!key) return null;
  const client = getS3();
  const resp = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
  return { key, ...resp };
}

async function deletePublicUrl(url) {
  const key = keyFromPublicUrl(url);
  if (!key) return false;

  const client = getS3();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  return true;
}

module.exports = {
  extFromMime,
  buildKey,
  uploadBuffer,
  uploadFile,
  uploadRemoteFile,
  uploadVideoFileWithThumbnail,
  uploadVideoBufferWithThumbnail,
  uploadRemoteVideoWithThumbnail,
  getObjectByPublicUrl,
  deletePublicUrl,
};
