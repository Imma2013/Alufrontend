'use client';

import { useEffect, useState } from 'react';
import { getFileUrl } from '../fileSystem';
import { Post } from '../db';
import ImageCarousel from './ImageCarousel';

interface MediaItemProps {
  post: Post;
  videoControls?: boolean;
  autoPlayVideo?: boolean;
  videoObjectFit?: 'cover' | 'contain';
  mutedVideo?: boolean;
}

export default function MediaItem({
  post,
  videoControls = true,
  autoPlayVideo = false,
  videoObjectFit = 'cover',
  mutedVideo = false,
}: MediaItemProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [isRemote, setIsRemote] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (!post.contentUrl) return;

    // If contentUrl is a full URL (from cloud sync / Cloudinary), use directly
    if (post.contentUrl.startsWith('http')) {
      setLocalUrl(post.contentUrl);
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
  }, [post.contentUrl]);

  // Check for multi-image carousel
  const hasMultipleImages = post.images && post.images.length > 1;

  if (!localUrl && !hasMultipleImages) {
    return <div className="w-full h-full bg-[var(--alu-surface)] animate-pulse rounded-lg"></div>;
  }

  // Multi-image carousel
  if (hasMultipleImages && post.images) {
    return <ImageCarousel images={post.images} />;
  }

  // Single image or video
  return (
    <>
      {post.mediaType === 'image' ? (
        <img src={localUrl || ''} alt={post.safePrompt} className="object-cover w-full h-full" />
      ) : (
        <video
          src={localUrl || ''}
          controls={videoControls}
          autoPlay={autoPlayVideo}
          loop={autoPlayVideo}
          muted={mutedVideo}
          playsInline
          className={`${videoObjectFit === 'contain' ? 'object-contain' : 'object-cover'} w-full h-full`}
        />
      )}
    </>
  );
}
