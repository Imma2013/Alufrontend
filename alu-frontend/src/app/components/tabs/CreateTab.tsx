'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import { ImageIcon, ZapIcon, FilmIcon, UploadIcon, GlobeIcon, LockIcon, UsersIcon } from '../icons';
import { db } from '../../db';
import { saveFileFromBlob } from '../../fileSystem';
import ImageCarousel from '../ImageCarousel';

type ContentType = 'image' | 'short' | 'video';

export default function CreateTab() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const displayName = user?.fullName || user?.firstName || '';
  const avatarUrl = user?.imageUrl || '';

  const [selectedType, setSelectedType] = useState<ContentType>('image');
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('everyone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [videoQuality, setVideoQuality] = useState<'360p' | '720p' | '1080p' | '4k'>('360p');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setConfigError(getBackendConfigError());
  }, [backendUrl]);

  const types: { key: ContentType; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: 'image', label: 'Image', desc: 'Manual upload', icon: <ImageIcon size={24} /> },
    { key: 'short', label: 'Shorts', desc: 'Up to 1 minute', icon: <ZapIcon size={24} /> },
    { key: 'video', label: 'Videos', desc: '1 minute and up', icon: <FilmIcon size={24} /> },
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
    setVideoQuality('360p');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    setUploadProgress(2);
    setUploadStep('Preparing upload...');

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
      formData.append('is_ai', 'false');
      formData.append('visibility', privacy);
      formData.append('displayName', displayName);
      formData.append('avatarUrl', avatarUrl);
      if (selectedType !== 'image') formData.append('quality', videoQuality);

      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${backendUrl}/upload`, true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 92);
          setUploadProgress(Math.max(3, Math.min(percent, 92)));
          setUploadStep('Uploading content...');
        };

        xhr.onerror = () => reject(new Error('Upload failed. Network error.'));
        xhr.onload = () => {
          const status = xhr.status || 0;
          let data: any = {};
          try {
            data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          } catch {
          }
          if (status < 200 || status >= 300) {
            reject(new Error(data?.error || data?.message || `Upload failed (${status})`));
            return;
          }
          resolve(data);
        };

        xhr.send(formData);
      });

      setUploadProgress(96);
      setUploadStep('Finalizing post...');

      if (result.post) {
        if (selectedType === 'image' && files.length > 1) {
          await db.posts.put({
            ...result.post,
            synced: 1,
            updatedAt: new Date(),
          });
        } else {
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
        setUploadProgress(100);
        setUploadStep('Upload complete.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setUploadStep('Upload failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[500px] mx-auto px-4 py-6 animate-fade-in">
      <h2 className="text-xl font-bold text-alu-text mb-6">Create</h2>

      {configError && (
        <div className="mb-6 p-3 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs">
          {configError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        {types.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setSelectedType(t.key);
              clearFile();
            }}
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

      {files.length > 0 && selectedType !== 'image' && (
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

      <div className="mb-6">
        <label className="text-xs font-semibold text-alu-text-secondary mb-2 block">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption... use @ to tag people"
          className="w-full h-20 p-3 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none resize-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow"
        />
      </div>

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

      {isLoading && (
        <div className="mb-6 p-4 rounded-xl border border-[var(--alu-primary)]/25 bg-gradient-to-r from-[var(--alu-primary-glow)] to-white animate-fade-in">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-alu-text">Uploading Content</span>
            <span className="text-xs font-bold text-[var(--alu-primary-dark)]">{uploadProgress}%</span>
          </div>
          <div className="w-full h-2.5 bg-white/80 border border-[var(--alu-primary)]/20 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${uploadProgress}%`,
                background: 'linear-gradient(90deg, var(--alu-primary-dark), var(--alu-primary), var(--alu-primary-light))',
              }}
            />
          </div>
          <p className="text-[11px] text-alu-text-secondary mt-2">{uploadStep || 'Working...'}</p>
        </div>
      )}

      {error && <p className="text-sm text-[var(--alu-danger)] mb-4">{error}</p>}
      {success && <p className="text-sm text-[var(--alu-success)] mb-4">Content uploaded successfully!</p>}

      <button
        onClick={handleUpload}
        disabled={isLoading || files.length === 0}
        className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
      >
        {isLoading ? 'Uploading...' : 'Post'}
      </button>
    </div>
  );
}
