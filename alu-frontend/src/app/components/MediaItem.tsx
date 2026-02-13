'use client';

import { useEffect, useState } from 'react';
import { getFileUrl } from '../fileSystem';
import { Post } from '../db';
import ImageCarousel from './ImageCarousel';

export default function MediaItem({ post }: { post: Post }) {
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
        <video src={localUrl || ''} controls playsInline className="object-cover w-full h-full" />
      )}
    </>
  );
}
