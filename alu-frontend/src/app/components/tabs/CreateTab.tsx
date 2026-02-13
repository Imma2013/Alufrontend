'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { ImageIcon, ZapIcon, FilmIcon, SparkleIcon, UploadIcon, GlobeIcon, LockIcon, UsersIcon } from '../icons';
import { db } from '../../db';
import { saveFileFromUrl, saveFileFromBlob } from '../../fileSystem';

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

  // Long video progress state
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStep, setVideoStep] = useState('');

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isAI, setIsAI] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'360p' | '720p' | '1080p' | '4k'>('360p');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real usage data
  const [usage, setUsage] = useState<{ dailyImages: number; monthlyShorts: number; bonusImages: number; limits: { image: number; short: number }; isPro: boolean } | null>(null);

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/usage`, {
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
  }, [success]); // re-fetch after successful generation

  // Dynamic types based on mode
  const types: { key: ContentType; label: string; desc: string; icon: React.ReactNode; videoType?: 'short' | 'long' }[] = mode === 'ai'
    ? [
        { key: 'image', label: 'Image', desc: 'AI generated', icon: <ImageIcon size={24} /> },
        { key: 'short', label: 'Shorts', desc: 'Pro only', icon: <ZapIcon size={24} />, videoType: 'short' },
      ]
    : [
        { key: 'image', label: 'Image', desc: 'Manual upload', icon: <ImageIcon size={24} /> },
        { key: 'short', label: 'Short Video', desc: 'Under 1 minute', icon: <ZapIcon size={24} />, videoType: 'short' },
        { key: 'video', label: 'Long Video', desc: 'YouTube-style', icon: <FilmIcon size={24} />, videoType: 'long' },
      ];

  const privacyOptions = [
    { value: 'everyone', label: 'Everyone', icon: <GlobeIcon size={16} /> },
    { value: 'followers', label: 'Followers', icon: <UsersIcon size={16} /> },
    { value: 'private', label: 'Only me', icon: <LockIcon size={16} /> },
  ];

  const acceptTypes = selectedType === 'image'
    ? 'image/jpeg,image/png,image/gif,image/webp'
    : 'video/mp4,video/quicktime,video/webm';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Validate size (100MB)
    if (selected.size > 100 * 1024 * 1024) {
      setError('File too large. Maximum size is 100MB.');
      return;
    }

    setFile(selected);
    setError(null);
    setSuccess(false);

    // Create preview
    const url = URL.createObjectURL(selected);
    setPreview(url);
  };

  const clearFile = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setIsAI(false);
    setVideoQuality('360p');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const token = await getToken();
      if (!token) throw new Error('You must be signed in to upload.');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', file.type.startsWith('image/') ? 'image' : 'video');
      formData.append('caption', caption);
      if (selectedType === 'short') formData.append('videoType', 'short');
      if (selectedType === 'video') formData.append('videoType', 'long');
      formData.append('is_ai', isAI ? 'true' : 'false');
      formData.append('visibility', privacy);
      formData.append('displayName', displayName);
      formData.append('avatarUrl', avatarUrl);
      if (!file.type.startsWith('image/')) formData.append('quality', videoQuality);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/upload`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Upload failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.post) {
        // Try to save file locally to OPFS (may return null if not supported)
        const ext = result.post.mediaType === 'image' ? 'png' : 'mp4';
        const fileName = `${result.post._id}.${ext}`;
        const fileHandle = await saveFileFromBlob(file, fileName);

        // Save to Dexie (use contentUrl from backend if OPFS failed)
        await db.posts.put({
          ...result.post,
          contentUrl: fileHandle ? fileName : result.post.contentUrl,
          synced: 1,
          updatedAt: new Date(),
        });

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
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setVideoJobId(null);
    setVideoProgress(0);
    setVideoStep('');

    try {
      const token = await getToken();
      if (!token) throw new Error('You must be signed in to generate content.');

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

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
          const errData = await res.json();
          throw new Error(errData.error || `Error: ${res.status}`);
        }

        const { jobId } = await res.json();
        setVideoJobId(jobId);
        setVideoStep('Starting short generation...');

        // Poll for progress
        let complete = false;
        while (!complete) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const statusRes = await fetch(`${backendUrl}/generate/status/${jobId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });

          if (!statusRes.ok) {
            throw new Error('Failed to check generation status');
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
          const errData = await response.json();
          throw new Error(errData.error || `Error: ${response.status}`);
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

      {/* Content Type Selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {types.map((t) => (
          <button
            key={t.key}
            onClick={() => { setSelectedType(t.key); clearFile(); }}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${selectedType === t.key
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
          onClick={() => setMode('ai')}
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
            className="hidden"
          />
          {!file ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-alu-border rounded-xl p-8 text-center hover:border-[var(--alu-primary)] hover:bg-[var(--alu-primary-glow)] transition-all duration-200 cursor-pointer"
            >
              <div className="flex justify-center mb-3 text-alu-text-tertiary">
                <UploadIcon size={40} />
              </div>
              <p className="text-sm font-semibold text-alu-text mb-1">
                Tap to upload {selectedType === 'image' ? 'a photo' : 'a video'}
              </p>
              <p className="text-xs text-alu-text-tertiary">
                {selectedType === 'image' ? 'JPG, PNG, GIF, WebP' : 'MP4, MOV, WebM'} — max 100MB
              </p>
            </button>
          ) : (
            <div className="relative rounded-xl overflow-hidden border-2 border-[var(--alu-primary)] bg-black">
              {file.type.startsWith('image/') ? (
                <img src={preview!} alt="Preview" className="w-full max-h-80 object-contain" />
              ) : (
                <video src={preview!} controls playsInline className="w-full max-h-80" />
              )}
              <button
                onClick={clearFile}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
              <div className="absolute bottom-2 left-2 text-[11px] bg-black/60 text-white px-2 py-1 rounded">
                {(file.size / (1024 * 1024)).toFixed(1)}MB
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
                  <p className="text-xs text-alu-text-secondary">
                    {usage.isPro ? 'Resets monthly' : 'Upgrade to Pro for 5/month'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[var(--alu-primary)]">
                    {Math.max(0, usage.limits.short - usage.monthlyShorts)}
                  </div>
                  <div className="text-xs text-alu-text-tertiary">
                    of {usage.limits.short}
                  </div>
                </div>
              </div>
              {!usage.isPro && (
                <button
                  onClick={() => window.open('/pricing', '_blank')}
                  className="mt-3 w-full py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[var(--alu-primary)] to-[var(--alu-primary-light)] hover:opacity-90 transition-opacity"
                >
                  Upgrade to Pro
                </button>
              )}
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
                    ? `${Math.max(0, usage.limits.image - usage.dailyImages)} images left today`
                    : usage.isPro
                      ? `${Math.max(0, usage.limits.short - usage.monthlyShorts)} shorts left this month`
                      : '🔒 Pro only'
                ) : 'Loading...'}
                {' · '}{usage?.isPro ? 'Pro' : 'Free tier'}
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
      {mode === 'upload' && file && !file.type.startsWith('image/') && (
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
        const canGenerateShort = !usage || selectedType !== 'short' || mode !== 'ai' || (usage.monthlyShorts < usage.limits.short && usage.isPro);
        const isDisabled = isLoading || (mode === 'ai' && !prompt.trim()) || (mode === 'upload' && !file) || !canGenerateShort;
        const tooltipText = !canGenerateShort && selectedType === 'short' && mode === 'ai'
          ? (usage?.isPro ? 'Monthly shorts limit reached' : 'Upgrade to Pro to generate shorts')
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
    </div>
  );
}
