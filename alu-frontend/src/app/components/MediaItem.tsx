'use client';

import { useEffect, useRef, useState } from 'react';
import { getFileUrl } from '../fileSystem';
import { Post } from '../db';
import ImageCarousel from './ImageCarousel';
import { resolveMediaList, resolveMediaUrl } from '../lib/mediaUrl';
import { buildExternalVideoEmbedUrl, isExternalVideoPost } from '../lib/externalVideo';

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
  const [nativeHlsSupported, setNativeHlsSupported] = useState(true);
  const [hlsJsSupported, setHlsJsSupported] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
    if (typeof document === 'undefined') return;
    const probe = document.createElement('video');
    const canPlayHls = !!(
      probe.canPlayType('application/vnd.apple.mpegurl') ||
      probe.canPlayType('application/x-mpegURL')
    );
    setNativeHlsSupported(canPlayHls);
  }, []);

  useEffect(() => {
    let active = true;
    if (nativeHlsSupported) {
      setHlsJsSupported(true);
      return;
    }
    (async () => {
      try {
        const mod = await import('hls.js');
        if (!active) return;
        setHlsJsSupported(Boolean(mod.default?.isSupported?.()));
      } catch {
        if (active) setHlsJsSupported(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [nativeHlsSupported]);

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
  const externalVideo = isExternalVideoPost(post);
  const externalEmbedUrl = externalVideo
    ? buildExternalVideoEmbedUrl(post, { autoplay: autoPlayVideo, muted: mutedVideo, loop: autoPlayVideo })
    : '';
  const isHlsStream = /\.m3u8(\?|$)/i.test(String(localUrl || ''));
  const shouldUseHlsJs = isHlsStream && !nativeHlsSupported && hlsJsSupported === true;
  const shouldFallbackFromHls = isHlsStream && !nativeHlsSupported && hlsJsSupported === false;

  useEffect(() => {
    if (!shouldUseHlsJs || !localUrl || !videoRef.current) return;
    let destroyed = false;
    let hls: import('hls.js').default | null = null;
    (async () => {
      try {
        const mod = await import('hls.js');
        const Hls = mod.default;
        if (destroyed || !videoRef.current || !Hls.isSupported()) return;
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hls.loadSource(localUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data?.fatal || !hls) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          setVideoFailed(true);
          hls.destroy();
          hls = null;
        });
      } catch {
        setVideoFailed(true);
      }
    })();
    return () => {
      destroyed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
  }, [localUrl, shouldUseHlsJs]);

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
        externalVideo ? (
          <iframe
            src={externalEmbedUrl}
            title={post.safePrompt || 'Imported video'}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : videoFailed ? (
          <img
            src={resolvedThumbnailUrl || fallbackImage || ''}
            alt={post.safePrompt}
            className={`${videoObjectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'} w-full h-full`}
          />
        ) : shouldFallbackFromHls ? (
          <img
            src={resolvedThumbnailUrl || fallbackImage || ''}
            alt={post.safePrompt}
            className={`${videoObjectFit === 'contain' ? 'object-contain bg-black' : 'object-cover'} w-full h-full`}
          />
        ) : (
          <video
            ref={videoRef}
            src={shouldUseHlsJs ? undefined : (localUrl || '')}
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
