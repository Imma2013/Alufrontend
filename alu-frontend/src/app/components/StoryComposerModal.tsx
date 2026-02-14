'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Story, db } from '../db';
import { useAuth } from '@clerk/nextjs';

interface StoryComposerModalProps {
  isOpen: boolean;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  onClose: () => void;
}

const TEXT_COLORS = ['#ffffff', '#fef08a', '#fca5a5', '#93c5fd', '#86efac', '#111111'];

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

export default function StoryComposerModal({ isOpen, userId, displayName, avatarUrl = '', onClose }: StoryComposerModalProps) {
  const { getToken } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [text, setText] = useState('');
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [textSize, setTextSize] = useState(42);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setImageUrl('');
      setText('');
      setTextColor(TEXT_COLORS[0]);
      setTextSize(42);
      setError(null);
      setIsSaving(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    try {
      setError(null);
      const dataUrl = await readFileAsDataUrl(file);
      setImageUrl(dataUrl);
    } catch {
      setError('Unable to load selected image.');
    }
  };

  const handleShare = async () => {
    if (!imageUrl || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const existing = await db.stories.where('userId').equals(userId).toArray();
      const activeExisting = existing.filter((story) => new Date(story.expiresAt).getTime() > Date.now());
      if (activeExisting.length > 0) {
        await db.stories.bulkDelete(activeExisting.map((story) => story._id));
      }

      const token = await getToken();
      if (!token) throw new Error('You must be signed in to share a story.');

      const res = await fetch(`${BACKEND_URL}/stories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageUrl,
          text: text.trim(),
          textColor,
          textSize,
          displayName,
          avatarUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create story');
      }

      const data = await res.json();
      const story: Story = data.story || {
        _id: `story_${userId}_${Date.now()}`,
        userId,
        imageUrl,
        text: text.trim(),
        textColor,
        textSize,
        createdAt: now,
        expiresAt: expires,
        displayName,
        avatarUrl,
        viewedBy: [userId],
      };
      await db.stories.put({
        ...story,
        createdAt: new Date(story.createdAt),
        expiresAt: new Date(story.expiresAt),
      });
      onClose();
    } catch {
      setError('Failed to share story. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-black/85 flex items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="w-full h-[100dvh] sm:h-[90dvh] sm:max-h-[820px] sm:max-w-[440px] bg-[#111] sm:rounded-2xl overflow-hidden relative border border-white/10">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {!imageUrl ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <p className="text-white text-xl font-bold mb-2">Create story</p>
            <p className="text-white/70 text-sm mb-6">One photo with text overlay</p>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleSelectImage} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="h-11 px-6 rounded-full bg-white text-[#111] text-sm font-semibold"
            >
              Select Photo
            </button>
            {error && <p className="text-red-300 text-sm mt-4">{error}</p>}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="relative flex-1 bg-black">
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
              {text.trim() && (
                <div className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none">
                  <p
                    className="font-bold text-center leading-tight break-words max-w-full"
                    style={{ color: textColor, textShadow: '0 2px 12px rgba(0,0,0,0.7)', fontSize: `${textSize}px` }}
                  >
                    {text}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-[#121212] border-t border-white/10 p-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 90))}
                placeholder="Add text"
                className="w-full h-10 px-4 rounded-full bg-white/10 text-white text-sm placeholder:text-white/60 outline-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setTextSize((prev) => Math.max(24, prev - 2))}
                  className="w-8 h-8 rounded-full bg-white/10 text-white text-sm font-semibold"
                  aria-label="Smaller text"
                >
                  A-
                </button>
                <input
                  type="range"
                  min={24}
                  max={64}
                  value={textSize}
                  onChange={(e) => setTextSize(Number(e.target.value))}
                  className="flex-1 accent-[#0095f6]"
                />
                <button
                  onClick={() => setTextSize((prev) => Math.min(64, prev + 2))}
                  className="w-8 h-8 rounded-full bg-white/10 text-white text-sm font-semibold"
                  aria-label="Larger text"
                >
                  A+
                </button>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setTextColor(color)}
                      className={`w-6 h-6 rounded-full border-2 ${textColor === color ? 'border-white' : 'border-white/30'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <button
                  onClick={handleShare}
                  disabled={isSaving}
                  className="h-9 px-4 rounded-full bg-[#0095f6] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {isSaving ? 'Sharing...' : 'Share'}
                </button>
              </div>
              {error && <p className="text-red-300 text-xs mt-2">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
