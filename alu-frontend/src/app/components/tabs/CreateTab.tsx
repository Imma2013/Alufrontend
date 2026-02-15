'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useState, useRef, useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { ImageIcon, ZapIcon, FilmIcon, SparkleIcon, UploadIcon, GlobeIcon, LockIcon, UsersIcon } from '../icons';
import { db } from '../../db';
import { saveFileFromUrl, saveFileFromBlob } from '../../fileSystem';
import ImageCarousel from '../ImageCarousel';

type ContentType = 'image' | 'short' | 'video';

export default function CreateTab() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const displayName = user?.fullName || user?.firstName || '';
  const avatarUrl = user?.imageUrl || '';
  const [selectedType, setSelectedType] = useState<ContentType>('image');
  const [mode, setMode] = useState<'upload' | 'ai'>('ai');
  const [prompt, setPrompt] = useState('');
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('everyone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Long video progress state
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStep, setVideoStep] = useState('');

  // Upload state
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isAI, setIsAI] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'360p' | '720p' | '1080p' | '4k'>('360p');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real usage data
  const [usage, setUsage] = useState<{
    dailyImages: number;
    dailyShorts: number;
    bonusImages: number;
    bonusShorts: number;
    remainingImages: number;
    remainingShorts: number;
    limits: { image: number; short: number };
    isPro: boolean;
  } | null>(null);
  const backendUrl = BACKEND_URL;

  const getBackendConfigError = () => {
    if (typeof window === 'undefined') return null;
    const configuredBackend = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!configuredBackend) {
      return 'Backend not configured. Set NEXT_PUBLIC_BACKEND_URL to your Render API URL.';
    }
    try {
      const backend = new URL(configuredBackend, window.location.origin);
      const frontend = new URL(window.location.origin);
      if (backend.host === frontend.host) {
        return 'NEXT_PUBLIC_BACKEND_URL points to this frontend domain. Set it to your Render backend URL.';
      }
    } catch {
      return 'NEXT_PUBLIC_BACKEND_URL is invalid. Use full URL like https://your-backend.onrender.com';
    }
    return null;
  };

  const parseErrorResponse = async (res: Response, fallback: string) => {
    const contentType = res.headers.get('content-type') || '';
    const calledUrl = res.url || `${backendUrl}/(unknown-endpoint)`;
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      return data?.error || data?.message || `${fallback} (${res.status})`;
    }
    const text = await res.text().catch(() => '');
    const preview = text.replace(/\s+/g, ' ').slice(0, 180);
    if (preview.startsWith('<!DOCTYPE') || preview.startsWith('<html')) {
      return `${fallback} (${res.status}). Received HTML instead of API JSON from: ${calledUrl}`;
    }
    return `${fallback} (${res.status}). Non-JSON response from ${calledUrl}: ${preview || 'empty response'}`;
  };

  useEffect(() => {
    setConfigError(getBackendConfigError());
  }, [backendUrl]);

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const cfgErr = getBackendConfigError();
        if (cfgErr) {
          setConfigError(cfgErr);
          return;
        }
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${backendUrl}/usage`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          setUsage(await res.json());
        }
      } catch (e) {
        console.error('Failed to fetch usage:', e);
      }
    };
    fetchUsage();
  }, [success, getToken, backendUrl]); // re-fetch after successful generation

  const handleUpgrade = async (mode: 'subscription' | 'payment' | 'short') => {
    const token = await getToken();
    if (!token) return;
    try {
      const cfgErr = getBackendConfigError();
      if (cfgErr) throw new Error(cfgErr);
      setUpgradeError(null);
      const proPriceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
      const creditPriceId = process.env.NEXT_PUBLIC_STRIPE_CREDIT_PRICE_ID;
      const shortPriceId = process.env.NEXT_PUBLIC_STRIPE_SHORT_PRICE_ID;
      const priceId = mode === 'subscription'
        ? proPriceId
        : (mode === 'short' ? shortPriceId : creditPriceId);
      if (!priceId) {
        throw new Error(
          mode === 'subscription'
            ? 'Stripe Pro price is not configured.'
            : (mode === 'short'
              ? 'Stripe short credit price is not configured.'
              : 'Stripe credit pack price is not configured.')
        );
      }
      if (!String(priceId).startsWith('price_')) {
        throw new Error('Stripe frontend env must use a price_... ID (not prod_...).');
      }

      const health = await fetch(`${backendUrl}/`, { method: 'GET' });
      if (!health.ok) {
        throw new Error(`Backend is not reachable (${health.status}). Check NEXT_PUBLIC_BACKEND_URL.`);
      }

      const res = await fetch(`${backendUrl}/payments/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ priceId, mode }),
      });
      if (!res.ok) {
        const errMsg = await parseErrorResponse(res, 'Unable to start checkout session');
        throw new Error(errMsg);
      }
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.assign(data.url);
      } else {
        throw new Error('Checkout URL missing from server response.');
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      const message = err instanceof Error ? err.message : 'Checkout failed.';
      setUpgradeError(message);
    }
  };

  const types: { key: ContentType; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: 'image', label: 'Image', desc: mode === 'ai' ? 'AI generated' : 'Manual upload', icon: <ImageIcon size={24} /> },
    { key: 'short', label: 'Shorts', desc: mode === 'ai' ? 'AI generated' : 'Up to 1 minute', icon: <ZapIcon size={24} /> },
    { key: 'video', label: 'Videos', desc: mode === 'ai' ? 'Upload only' : '1 minute and up', icon: <FilmIcon size={24} /> },
  ];

  const privacyOptions = [
    { value: 'everyone', label: 'Everyone', icon: <GlobeIcon size={16} /> },
    { value: 'followers', label: 'Followers', icon: <UsersIcon size={16} /> },
    { value: 'private', label: 'Only me', icon: <LockIcon size={16} /> },
  ];

  const acceptTypes = selectedType === 'image'
    ? 'image/jpeg,image/png,image/gif,image/webp'
    : 'video/mp4,video/quicktime,video/webm';

  const getVideoDuration = (selected: File): Promise<number> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(selected);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = video.duration;
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read video duration'));
      };
      video.src = url;
    });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const validateAndSet = async () => {
      try {
        const maxBytes = 200 * 1024 * 1024;

        if (selectedType === 'image') {
          if (selectedFiles.length > 3) {
            throw new Error('Maximum 3 images per post.');
          }
          if (selectedFiles.some((f) => !f.type.startsWith('image/'))) {
            throw new Error('Image posts only accept image files.');
          }
        } else {
          if (selectedFiles.length > 1) {
            throw new Error('Video posts accept one video file at a time.');
          }
          if (!selectedFiles[0].type.startsWith('video/')) {
            throw new Error('Video posts only accept video files.');
          }
        }

        for (const selected of selectedFiles) {
          if (selected.size > maxBytes) {
            throw new Error('File too large. Maximum size is 200MB.');
          }
        }

        if (selectedType !== 'image') {
          const duration = await getVideoDuration(selectedFiles[0]);
          if (selectedType === 'short' && duration > 60) {
            throw new Error('Shorts must be 60 seconds or less.');
          }
          if (selectedType === 'video' && duration < 60) {
            throw new Error('Videos must be at least 60 seconds.');
          }
        }

        const nextPreviews = selectedFiles.map((selected) => URL.createObjectURL(selected));
        setFiles(selectedFiles);
        setPreviews(nextPreviews);
        setError(null);
        setSuccess(false);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid file selection';
        setError(message);
      }
    };

    void validateAndSet();
  };

  const clearFile = () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview));
    setFiles([]);
    setPreviews([]);
    setIsAI(false);
    setVideoQuality('360p');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const cfgErr = getBackendConfigError();
      if (cfgErr) throw new Error(cfgErr);
      const token = await getToken();
      if (!token) throw new Error('You must be signed in to upload.');

      const formData = new FormData();
      files.forEach((selected) => formData.append('files', selected));
      formData.append('mediaType', selectedType === 'image' ? 'image' : 'video');
      formData.append('caption', caption);
      if (selectedType === 'short') formData.append('videoType', 'short');
      if (selectedType === 'video') formData.append('videoType', 'long');
      formData.append('is_ai', isAI ? 'true' : 'false');
      formData.append('visibility', privacy);
      formData.append('displayName', displayName);
      formData.append('avatarUrl', avatarUrl);
      if (selectedType !== 'image') formData.append('quality', videoQuality);

      const response = await fetch(
        `${backendUrl}/upload`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const errMsg = await parseErrorResponse(response, 'Upload failed');
        throw new Error(errMsg);
      }

      const result = await response.json();

      if (result.post) {
        if (selectedType === 'image' && files.length > 1) {
          // Multi-image posts render from synced image URLs (carousel).
          await db.posts.put({
            ...result.post,
            synced: 1,
            updatedAt: new Date(),
          });
        } else {
          // Single file: save local copy in OPFS when supported.
          const ext = result.post.mediaType === 'image' ? 'png' : 'mp4';
          const fileName = `${result.post._id}.${ext}`;
          const fileHandle = await saveFileFromBlob(files[0], fileName);

          await db.posts.put({
            ...result.post,
            contentUrl: fileHandle ? fileName : result.post.contentUrl,
            synced: 1,
            updatedAt: new Date(),
          });
        }

        setSuccess(true);
        clearFile();
        setCaption('');
        setIsAI(false);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!prompt.trim()) return;
    if (selectedType === 'video') {
      setError('AI video generation is not enabled in this tab yet. Use Upload for videos.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setVideoJobId(null);
    setVideoProgress(0);
    setVideoStep('');

    try {
      const cfgErr = getBackendConfigError();
      if (cfgErr) throw new Error(cfgErr);
      const token = await getToken();
      if (!token) throw new Error('You must be signed in to generate content.');

      if (selectedType === 'short') {
        // --- SHORT VIDEO STITCHING: 60s, 9:16 ---
        const res = await fetch(`${backendUrl}/generate/short-video`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            durationSeconds: 60,
            visibility: privacy,
            displayName,
            avatarUrl,
          }),
        });

        if (!res.ok) {
          const errMsg = await parseErrorResponse(res, 'Short generation failed');
          throw new Error(errMsg);
        }

        const { jobId } = await res.json();
        setVideoJobId(jobId);
        setVideoStep('Starting short generation...');

        // Poll for progress
        let complete = false;
        while (!complete) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const pollToken = await getToken({ skipCache: true });
          if (!pollToken) {
            throw new Error('Session expired while checking short status. Please sign in again.');
          }
          const statusRes = await fetch(`${backendUrl}/generate/status/${jobId}`, {
            headers: { 'Authorization': `Bearer ${pollToken}` },
          });

          if (!statusRes.ok) {
            const statusErr = await parseErrorResponse(statusRes, 'Failed to check generation status');
            throw new Error(statusErr);
          }

          const status = await statusRes.json();
          setVideoProgress(status.progress);
          setVideoStep(status.currentStep);

          if (status.status === 'complete') {
            complete = true;
            // Save to Dexie
            if (status.videoUrl) {
              const fileName = `${status.postId || Date.now()}.mp4`;
              await saveFileFromUrl(status.videoUrl, fileName);
              await db.posts.put({
                _id: status.postId,
                contentUrl: fileName,
                safePrompt: prompt.trim(),
                mediaType: 'video',
                videoType: 'short',
                is_ai: true,
                isLongForm: false,
                userId: '',
                timestamp: new Date(),
                synced: 1,
                updatedAt: new Date(),
                visibility: privacy as 'everyone' | 'followers' | 'private',
                thumbnailUrl: status.thumbnailUrl,
                displayName,
                avatarUrl,
              });
            }
            setSuccess(true);
            setPrompt('');
            setCaption('');
          } else if (status.status === 'failed') {
            throw new Error(status.error || 'Short video generation failed');
          }
        }
      } else {
        // --- IMAGE: single /generate call ---
        const body = {
          prompt: prompt.trim(),
          type: 'image',
          isLongVideo: false,
          visibility: privacy,
          displayName,
          avatarUrl,
        };

        const response = await fetch(`${backendUrl}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errMsg = await parseErrorResponse(response, 'Image generation failed');
          throw new Error(errMsg);
        }

        const result = await response.json();

        if (result.post && result.post.contentUrl) {
          const fileName = `${result.post._id}.png`;

          await saveFileFromUrl(result.post.contentUrl, fileName);

          await db.posts.put({
            ...result.post,
            contentUrl: fileName,
            synced: 1,
            updatedAt: new Date(),
          });

          setSuccess(true);
          setPrompt('');
          setCaption('');
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
      setVideoJobId(null);
    }
  };

  return (
    <div className="w-full max-w-[500px] mx-auto px-4 py-6 animate-fade-in">
      {/* Header */}
      <h2 className="text-xl font-bold text-alu-text mb-6">Create</h2>

      {/* Upgrade Entry */}
      <div className="mb-6 p-4 rounded-xl border border-[var(--alu-primary)]/30 bg-gradient-to-r from-[var(--alu-primary-glow)] to-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-alu-text">Need more AI credits?</p>
            <p className="text-xs text-alu-text-secondary mt-1">
              Free: 3 images/day, 1 short/week.
            </p>
          </div>
          <button
            onClick={() => { setUpgradeError(null); setShowUpgradeModal(true); }}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
          >
            Upgrade
          </button>
        </div>
      </div>
      {configError && (
        <div className="mb-6 p-3 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs">
          {configError}
        </div>
      )}

      {/* Content Type Selector */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {types.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              if (mode === 'ai' && t.key === 'video') return;
              setSelectedType(t.key);
              clearFile();
            }}
            disabled={mode === 'ai' && t.key === 'video'}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${mode === 'ai' && t.key === 'video' ? 'opacity-60 cursor-not-allowed' : ''} ${selectedType === t.key
              ? 'border-[var(--alu-primary)] bg-[var(--alu-primary-glow)]'
              : 'border-alu-border hover:border-alu-text-tertiary bg-white'
              }`}
          >
            <span className={selectedType === t.key ? 'text-[var(--alu-primary-dark)]' : 'text-alu-text-secondary'}>{t.icon}</span>
            <span className={`text-sm font-semibold ${selectedType === t.key ? 'text-[var(--alu-primary-dark)]' : 'text-alu-text'}`}>
              {t.label}
            </span>
            <span className="text-[11px] text-alu-text-tertiary">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Mode Toggle: Upload vs AI */}
      <div className="flex bg-alu-surface rounded-xl p-1 mb-6">
        <button
          onClick={() => setMode('upload')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${mode === 'upload' ? 'bg-white text-alu-text shadow-sm' : 'text-alu-text-tertiary hover:text-alu-text-secondary'
            }`}
        >
          <UploadIcon size={16} /> Upload
        </button>
        <button
          onClick={() => {
            setMode('ai');
            if (selectedType === 'video') setSelectedType('image');
          }}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${mode === 'ai' ? 'bg-white text-alu-text shadow-sm' : 'text-alu-text-tertiary hover:text-alu-text-secondary'
            }`}
        >
          <SparkleIcon size={16} /> AI Generate
        </button>
      </div>

      {/* Upload Area or AI Prompt */}
      {mode === 'upload' ? (
        <div className="mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptTypes}
            onChange={handleFileSelect}
            multiple={selectedType === 'image'}
            className="hidden"
          />
          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-alu-border rounded-xl p-8 text-center hover:border-[var(--alu-primary)] hover:bg-[var(--alu-primary-glow)] transition-all duration-200 cursor-pointer"
            >
              <div className="flex justify-center mb-3 text-alu-text-tertiary">
                <UploadIcon size={40} />
              </div>
              <p className="text-sm font-semibold text-alu-text mb-1">
                Tap to upload {selectedType === 'image' ? 'photos' : 'a video'}
              </p>
              <p className="text-xs text-alu-text-tertiary">
                {selectedType === 'image' ? 'JPG, PNG, GIF, WebP (up to 3)' : 'MP4, MOV, WebM'} - max 200MB
              </p>
            </button>
          ) : (
            <div className="relative rounded-xl overflow-hidden border-2 border-[var(--alu-primary)] bg-black">
              {selectedType === 'image' ? (
                <div className="w-full max-h-80 min-h-[220px]">
                  <ImageCarousel images={previews} />
                </div>
              ) : (
                <video src={previews[0]} controls playsInline className="w-full max-h-80" />
              )}
              <button
                onClick={clearFile}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
              <div className="absolute bottom-2 left-2 text-[11px] bg-black/60 text-white px-2 py-1 rounded">
                {files.length > 1 ? `${files.length} images` : `${(files[0].size / (1024 * 1024)).toFixed(1)}MB`}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Shorts Counter (AI mode, shorts selected) */}
          {selectedType === 'short' && usage && (
            <div className="mb-4 p-4 bg-gradient-to-r from-[var(--alu-primary-glow)] to-[var(--alu-surface)] rounded-xl border border-[var(--alu-primary)]/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[var(--alu-primary)]">
                      <ZapIcon size={18} />
                    </span>
                    <span className="text-sm font-bold text-alu-text">Shorts Remaining</span>
                  </div>
                  <p className="text-xs text-alu-text-secondary">Resets weekly</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[var(--alu-primary)]">
                    {usage.remainingShorts}
                  </div>
                  <div className="text-xs text-alu-text-tertiary">
                    of {usage.limits.short}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mb-6">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                selectedType === 'image'
                  ? 'Describe the image you want to create...'
                  : 'Describe your short video concept...'
              }
              className="w-full h-28 p-4 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none resize-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow"
            />
            <div className="flex justify-end mt-2">
              <span className="text-[11px] text-alu-text-tertiary">
                {usage ? (
                  selectedType === 'image'
                    ? `${usage.remainingImages} images available`
                    : `${usage.remainingShorts} shorts available`
                ) : 'Loading...'}
                {' - '}{usage?.isPro ? 'Pro' : 'Free tier'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* AI Content Label (upload mode only) */}
      {mode === 'upload' && (
        <div className="mb-6">
          <button
            onClick={() => setIsAI(!isAI)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${isAI
              ? 'bg-[var(--alu-primary-glow)] text-[var(--alu-primary-dark)] border border-[var(--alu-primary)]'
              : 'bg-alu-surface text-alu-text-secondary border border-transparent hover:border-alu-border'
              }`}
          >
            <SparkleIcon size={14} />
            AI Generated
          </button>
          <p className="text-[11px] text-alu-text-tertiary mt-1.5">Toggle if this content was made with AI</p>
        </div>
      )}

      {/* Video Quality (upload mode + video only) */}
      {mode === 'upload' && files.length > 0 && selectedType !== 'image' && (
        <div className="mb-6">
          <label className="text-xs font-semibold text-alu-text mb-2 block">Video Quality</label>
          <div className="flex gap-2">
            {(['360p', '720p', '1080p', selectedType === 'video' && '4k'].filter(Boolean) as string[]).map((quality) => (
              <button
                key={quality}
                onClick={() => setVideoQuality(quality as typeof videoQuality)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  videoQuality === quality
                    ? 'bg-[var(--alu-primary)] text-white'
                    : 'bg-alu-surface text-alu-text-secondary hover:bg-alu-border'
                }`}
              >
                {quality}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-alu-text-tertiary mt-1.5">
            {selectedType === 'video' ? 'Up to 4K for long videos' : 'Quality options for your video'}
          </p>
        </div>
      )}

      {/* Caption */}
      <div className="mb-6">
        <label className="text-xs font-semibold text-alu-text-secondary mb-2 block">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption... use @ to tag people"
          className="w-full h-20 p-3 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none resize-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow"
        />
      </div>

      {/* Privacy */}
      <div className="flex items-center gap-2 mb-6">
        {privacyOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPrivacy(opt.value)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${privacy === opt.value
              ? 'bg-[var(--alu-primary-glow)] text-[var(--alu-primary-dark)] border border-[var(--alu-primary)]'
              : 'bg-alu-surface text-alu-text-secondary border border-transparent hover:border-alu-border'
              }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* Video Generation Progress */}
      {videoJobId && isLoading && (
        <div className="mb-6 p-4 bg-alu-surface rounded-xl animate-fade-in">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-alu-text">Generating Video</span>
            <span className="text-xs font-bold text-[var(--alu-primary)]">{videoProgress}%</span>
          </div>
          <div className="w-full h-2 bg-alu-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${videoProgress}%`,
                background: 'linear-gradient(90deg, var(--alu-primary), var(--alu-primary-light))',
              }}
            />
          </div>
          <p className="text-[11px] text-alu-text-tertiary mt-2">{videoStep}</p>
        </div>
      )}

      {/* Error / Success */}
      {error && <p className="text-sm text-[var(--alu-danger)] mb-4">{error}</p>}
      {success && <p className="text-sm text-[var(--alu-success)] mb-4">Content {mode === 'ai' ? 'generated' : 'uploaded'} successfully!</p>}

      {/* Submit */}
      {(() => {
        const canGenerateShort = !usage || selectedType !== 'short' || mode !== 'ai' || usage.remainingShorts > 0;
        const isDisabled = isLoading || (mode === 'ai' && !prompt.trim()) || (mode === 'upload' && files.length === 0) || !canGenerateShort;
        const tooltipText = !canGenerateShort && selectedType === 'short' && mode === 'ai'
          ? 'Daily shorts limit reached'
          : '';

        return (
          <div className="relative group">
            <button
              onClick={mode === 'ai' ? handleAIGenerate : handleUpload}
              disabled={isDisabled}
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
              title={tooltipText}
            >
              {isLoading
                ? (mode === 'ai' ? 'Generating...' : 'Uploading...')
                : (mode === 'ai' ? 'Generate & Post' : 'Post')
              }
            </button>
            {tooltipText && isDisabled && !isLoading && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black/90 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {tooltipText}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-black/90" />
              </div>
            )}
          </div>
        );
      })()}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowUpgradeModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-[400px] w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-alu-text text-center mb-1">Upgrade Credits</h3>
            <p className="text-sm text-alu-text-secondary text-center mb-5">Pay for more AI images and shorts</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleUpgrade('subscription')}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
              >
                Pro Monthly
                <span className="block text-xs font-normal opacity-80 mt-0.5">Higher daily limits</span>
              </button>
              <button
                onClick={() => handleUpgrade('payment')}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors"
              >
                Credit Pack
                <span className="block text-xs font-normal text-alu-text-secondary mt-0.5">Adds extra AI image credits</span>
              </button>
              <button
                onClick={() => handleUpgrade('short')}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors"
              >
                Short Credit
                <span className="block text-xs font-normal text-alu-text-secondary mt-0.5">Adds one extra AI short credit</span>
              </button>
            </div>

            {upgradeError && (
              <p className="mt-3 text-xs text-red-600 text-center">{upgradeError}</p>
            )}

            <button
              onClick={() => setShowUpgradeModal(false)}
              className="w-full mt-3 py-2 text-sm text-alu-text-tertiary hover:text-alu-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


