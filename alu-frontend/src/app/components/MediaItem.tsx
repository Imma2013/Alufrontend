'use client';

import { useEffect, useState } from 'react';
import { getFileUrl } from '../fileSystem';
import { Post } from '../db';
import ImageCarousel from './ImageCarousel';
import { resolveMediaList, resolveMediaUrl } from '../lib/mediaUrl';

interface MediaItemProps {
  post: Post;
  videoControls?: boolean;
  autoPlayVideo?: boolean;
  videoObjectFit?: 'cover' | 'contain';
  imageObjectFit?: 'cover' | 'contain';
  mutedVideo?: boolean;
}

export default function MediaItem({
  post,
  videoControls = true,
  autoPlayVideo = false,
  videoObjectFit = 'cover',
  imageObjectFit = 'cover',
  mutedVideo = false,
}: MediaItemProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [isRemote, setIsRemote] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const resolvedRemoteContentUrl = post.contentUrl?.startsWith('http')
    ? resolveMediaUrl(post.contentUrl)
    : post.contentUrl;
  const resolvedThumbnailUrl = resolveMediaUrl(post.thumbnailUrl || '');
  const resolvedImages = resolveMediaList(post.images || []);
  const fallbackImage = resolvedImages.length > 0
    ? String(resolvedImages[0] || '').trim()
    : '';

  useEffect(() => {
    setImageFailed(false);
    setVideoFailed(false);
  }, [post._id, post.contentUrl, fallbackImage]);

  useEffect(() => {
    let isMounted = true;

    if (!post.contentUrl) return;

    // If contentUrl is a full URL (from cloud sync / Cloudinary), use directly
    if (post.contentUrl.startsWith('http')) {
      setLocalUrl(resolvedRemoteContentUrl);
      setIsRemote(true);
      return;
    }

    // Otherwise it's an OPFS filename — resolve to blob URL
    getFileUrl(post.contentUrl)
      .then(url => {
        if (isMounted) {
          setLocalUrl(url);
          setIsRemote(false);
        }
      })
      .catch(err => {
        console.error(`Could not load media for ${post.contentUrl}:`, err);
      });

    return () => {
      isMounted = false;
      // Only revoke blob URLs (not remote URLs)
      if (localUrl && !isRemote) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [post.contentUrl, resolvedRemoteContentUrl]);

  // Check for multi-image carousel
  const hasMultipleImages = resolvedImages.length > 1;

  if (!localUrl && !hasMultipleImages && !fallbackImage) {
    return <div className="w-full h-full bg-[var(--alu-surface)] animate-pulse rounded-lg"></div>;
  }

  // Multi-image carousel
  if (hasMultipleImages) {
    return <ImageCarousel images={resolvedImages} objectFit={imageObjectFit} />;
  }

  // Single image or video
  return (
    <>
      {post.mediaType === 'image' ? (
        <img
          src={imageFailed ? (fallbackImage || '') : (localUrl || fallbackImage || '')}
          alt={post.safePrompt}
          className={`${imageObjectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'} w-full h-full`}
          onError={() => {
            if (!imageFailed && fallbackImage && localUrl !== fallbackImage) {
              setImageFailed(true);
            }
          }}
        />
      ) : (
        videoFailed ? (
          <img
            src={resolvedThumbnailUrl || fallbackImage || ''}
            alt={post.safePrompt}
            className={`${videoObjectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'} w-full h-full`}
          />
        ) : (
          <video
            src={localUrl || ''}
            controls={videoControls}
            autoPlay={autoPlayVideo}
            loop={autoPlayVideo}
            muted={mutedVideo}
            playsInline
            poster={resolvedThumbnailUrl || undefined}
            className={`${videoObjectFit === 'contain' ? 'object-contain' : 'object-cover'} w-full h-full`}
            onError={() => setVideoFailed(true)}
          />
        )
      )}
    </>
  );
}
