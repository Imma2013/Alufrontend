'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Post, db } from '../db';

interface EditCaptionModalProps {
  post: Post;
  onClose: () => void;
  onSaved: (newCaption: string) => void;
}

export default function EditCaptionModal({ post, onClose, onSaved }: EditCaptionModalProps) {
  const { getToken } = useAuth();
  const [caption, setCaption] = useState(post.safePrompt || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!caption.trim()) {
      setError('Caption cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const backendUrl = BACKEND_URL;
      const res = await fetch(`${backendUrl}/posts/${post._id}/caption`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ caption: caption.trim() }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update caption');
      }

      // Update local Dexie
      await db.posts.update(post._id, { safePrompt: caption.trim() });

      onSaved(caption.trim());
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[500px] rounded-2xl p-6 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-alu-text mb-4">Edit caption</h2>

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption..."
          className="w-full h-32 p-3 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none resize-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow mb-4"
          autoFocus
        />

        {error && (
          <p className="text-sm text-red-500 mb-4">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-alu-surface text-alu-text hover:bg-alu-border transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !caption.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'linear-gradient(135deg, var(--alu-primary), var(--alu-primary-light))' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}



