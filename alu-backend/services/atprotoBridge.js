const { AtpAgent } = require('@atproto/api');
const { User, Post } = require('../config/db');
const { atprotoServiceUrl } = require('./atprotoClient');

function createPublicAgent() {
  return new AtpAgent({ service: atprotoServiceUrl() });
}

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

function mediaFromEmbed(embed) {
  if (!embed || typeof embed !== 'object') return null;

  if (embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images) && embed.images.length > 0) {
    const urls = embed.images.map((img) => normalizeUrl(img?.fullsize)).filter(Boolean);
    if (urls.length === 0) return null;
    return {
      mediaType: 'image',
      contentUrl: urls[0],
      images: urls.slice(0, 3),
      thumbnailUrl: normalizeUrl(embed.images?.[0]?.thumb),
    };
  }

  if (embed.$type === 'app.bsky.embed.video#view') {
    const playlist = normalizeUrl(embed.playlist);
    const thumb = normalizeUrl(embed.thumbnail);
    const contentUrl = playlist || thumb;
    if (!contentUrl) return null;
    return {
      mediaType: 'video',
      contentUrl,
      images: [],
      thumbnailUrl: thumb,
    };
  }

  if (embed.$type === 'app.bsky.embed.external#view') {
    const uri = normalizeUrl(embed.external?.uri);
    const thumb = normalizeUrl(embed.external?.thumb);
    const url = uri || thumb;
    if (!url) return null;
    const looksVideo = /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(url);
    return {
      mediaType: looksVideo ? 'video' : 'image',
      contentUrl: url,
      images: looksVideo ? [] : [url],
      thumbnailUrl: thumb,
    };
  }

  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    return mediaFromEmbed(embed.media);
  }

  return null;
}

async function ensureUserIdentity({ userId, handle, displayName, avatarUrl }) {
  const aliases = [userId, handle].map((v) => String(v || '').trim()).filter(Boolean);
  const update = {
    $setOnInsert: { userId, aliases: [userId] },
    $addToSet: aliases.length > 0 ? { aliases: { $each: aliases } } : undefined,
    $set: {
      ...(displayName ? { displayName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    },
  };
  if (!update.$addToSet) delete update.$addToSet;
  if (Object.keys(update.$set).length === 0) delete update.$set;
  await User.findOneAndUpdate({ userId }, update, { upsert: true, new: true });
}

async function syncFollows({ actor, maxFollows = 150 }) {
  const agent = createPublicAgent();
  const myUser = await User.findOne({ userId: actor }, { following: 1, _id: 0 });
  const existingFollowing = new Set(Array.isArray(myUser?.following) ? myUser.following : []);

  let cursor;
  let fetched = 0;
  const discovered = [];

  while (fetched < maxFollows) {
    const batchSize = Math.min(100, maxFollows - fetched);
    const res = await agent.app.bsky.graph.getFollows({ actor, limit: batchSize, cursor });
    const follows = Array.isArray(res?.data?.follows) ? res.data.follows : [];
    if (follows.length === 0) break;

    for (const f of follows) {
      const did = String(f?.did || '').trim();
      if (!did || did === actor) continue;
      discovered.push({
        userId: did,
        handle: String(f?.handle || '').trim(),
        displayName: String(f?.displayName || '').trim(),
        avatarUrl: String(f?.avatar || '').trim(),
      });
    }

    fetched += follows.length;
    cursor = res?.data?.cursor;
    if (!cursor) break;
  }

  const unique = [];
  const seen = new Set();
  for (const item of discovered) {
    if (seen.has(item.userId)) continue;
    seen.add(item.userId);
    unique.push(item);
  }

  await Promise.all(
    unique.map((f) =>
      ensureUserIdentity({
        userId: f.userId,
        handle: f.handle,
        displayName: f.displayName,
        avatarUrl: f.avatarUrl,
      })
    )
  );

  const newFollowing = unique.map((f) => f.userId).filter((id) => !existingFollowing.has(id));
  if (newFollowing.length > 0) {
    await User.findOneAndUpdate(
      { userId: actor },
      { $addToSet: { following: { $each: newFollowing } } },
      { upsert: true }
    );
    await User.updateMany(
      { userId: { $in: newFollowing } },
      { $addToSet: { followers: actor } }
    );
  }

  return {
    fetched,
    discovered: unique.length,
    added: newFollowing.length,
  };
}

async function importAuthorPosts({ actor, maxPosts = 20 }) {
  const agent = createPublicAgent();
  const res = await agent.app.bsky.feed.getAuthorFeed({ actor, limit: Math.min(Math.max(maxPosts, 1), 100) });
  const feed = Array.isArray(res?.data?.feed) ? res.data.feed : [];

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const item of feed) {
    const post = item?.post;
    if (!post?.uri) {
      skipped += 1;
      continue;
    }

    const media = mediaFromEmbed(post.embed);
    if (!media) {
      skipped += 1;
      continue;
    }

    const authorDid = String(post?.author?.did || actor || '').trim();
    if (!authorDid) {
      skipped += 1;
      continue;
    }

    const createdAtRaw = post?.record?.createdAt || post?.indexedAt || null;
    const timestamp = createdAtRaw ? new Date(createdAtRaw) : new Date();
    const caption = String(post?.record?.text || '').trim();
    const displayName = String(post?.author?.displayName || post?.author?.handle || authorDid).trim();
    const avatarUrl = String(post?.author?.avatar || '').trim();

    const existing = await Post.findOne({ sourceUri: post.uri }, { _id: 1, sourceUri: 1 });
    if (existing) {
      await Post.updateOne(
        { _id: existing._id },
        {
          $set: {
            caption,
            safePrompt: caption || 'Imported from Bluesky',
            displayName,
            avatarUrl,
            thumbnailUrl: media.thumbnailUrl || '',
            images: media.images,
            contentUrl: media.contentUrl,
            mediaType: media.mediaType,
            videoType: media.mediaType === 'video' ? 'short' : undefined,
            timestamp,
          },
        }
      );
      updated += 1;
      continue;
    }

    await Post.create({
      userId: authorDid,
      contentUrl: media.contentUrl,
      safePrompt: caption || 'Imported from Bluesky',
      originalPrompt: caption || '',
      caption,
      is_ai: false,
      mediaType: media.mediaType,
      videoType: media.mediaType === 'video' ? 'short' : undefined,
      timestamp,
      thumbnailUrl: media.thumbnailUrl || '',
      visibility: 'everyone',
      displayName,
      avatarUrl,
      images: media.images,
      status: 'ready',
      source: 'atproto',
      sourceUri: String(post.uri || ''),
      sourceCid: String(post.cid || ''),
    });
    imported += 1;
  }

  return { scanned: feed.length, imported, updated, skipped };
}

async function syncAtBridge({
  actorDid,
  actorHandle,
  importFollows = true,
  importOwnPosts = true,
  importFollowingPosts = false,
  maxFollows = 100,
  maxPostsPerActor = 10,
}) {
  const stats = {
    actorDid,
    actorHandle,
    follows: { fetched: 0, discovered: 0, added: 0 },
    posts: { scanned: 0, imported: 0, updated: 0, skipped: 0, actors: 0 },
  };

  await ensureUserIdentity({
    userId: actorDid,
    handle: actorHandle,
    displayName: actorHandle,
    avatarUrl: '',
  });

  if (importFollows) {
    stats.follows = await syncFollows({ actor: actorDid, maxFollows });
  }

  if (importOwnPosts) {
    const own = await importAuthorPosts({ actor: actorDid, maxPosts: maxPostsPerActor });
    stats.posts.scanned += own.scanned;
    stats.posts.imported += own.imported;
    stats.posts.updated += own.updated;
    stats.posts.skipped += own.skipped;
    stats.posts.actors += 1;
  }

  if (importFollowingPosts) {
    const me = await User.findOne({ userId: actorDid }, { following: 1, _id: 0 });
    const following = Array.isArray(me?.following) ? me.following.slice(0, Math.max(0, maxFollows)) : [];
    for (const followed of following) {
      const result = await importAuthorPosts({ actor: followed, maxPosts: maxPostsPerActor });
      stats.posts.scanned += result.scanned;
      stats.posts.imported += result.imported;
      stats.posts.updated += result.updated;
      stats.posts.skipped += result.skipped;
      stats.posts.actors += 1;
    }
  }

  await User.findOneAndUpdate(
    { userId: actorDid },
    {
      $set: {
        atBridgeLastSyncedAt: new Date(),
        atBridgeLastStats: stats,
      },
    },
    { upsert: true }
  );

  return stats;
}

module.exports = {
  syncAtBridge,
  syncFollows,
  importAuthorPosts,
};
