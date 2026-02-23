'use client';

import { BACKEND_URL } from '@/app/lib/backend';
import { useState, useEffect } from 'react';
import { useUser } from '../lib/auth';
import { useAuth } from '../lib/auth';

interface EditProfileProps {
    onBack: () => void;
}

export default function EditProfile({ onBack }: EditProfileProps) {
    const { user } = useUser();
    const { getToken } = useAuth();
    const [displayName, setDisplayName] = useState(user?.firstName || user?.username || '');
    const [bio, setBio] = useState((user?.unsafeMetadata?.bio as string) || '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentAvatarUrl, setCurrentAvatarUrl] = useState('');
    const [blueskyAvatarUrl, setBlueskyAvatarUrl] = useState('');
    const [avatarBroken, setAvatarBroken] = useState(false);

    const refreshServerProfile = async () => {
        if (!user?.id) return;
        try {
            const token = await getToken();
            const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(user.id)}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) return;
            const data = await res.json();
            setCurrentAvatarUrl(String(data?.avatarUrl || '').trim());
            setBlueskyAvatarUrl(String(data?.blueskyAvatarUrl || '').trim());
            setAvatarBroken(false);
        } catch {
        }
    };

    useEffect(() => {
        void refreshServerProfile();
    }, [user?.id]);

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        setError(null);

        try {
            // Update display name
            if (displayName.trim() !== (user.firstName || '')) {
                await user.update({ firstName: displayName.trim() });
            }

            // Update bio via unsafeMetadata
            await user.update({
                unsafeMetadata: {
                    ...user.unsafeMetadata,
                    bio: bio.trim(),
                },
            });

            // Sync latest display/avatar into backend directory for search/feed rendering.
            try {
                const token = await getToken();
                if (token) {
                    await fetch(`${BACKEND_URL}/users/me/sync`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                    });
                }
            } catch {
            }

            await refreshServerProfile();

            onBack();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to save profile';
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    const normalizedCurrentAvatar = String(currentAvatarUrl || '').trim();
    const normalizedBlueskyAvatar = String(blueskyAvatarUrl || '').trim();
    const normalizedStoredAvatar = String(user?.imageUrl || '').trim();
    const avatarToRender = normalizedBlueskyAvatar || normalizedCurrentAvatar || normalizedStoredAvatar;

    return (
        <div className="fixed inset-0 z-[100] bg-[var(--alu-bg)] animate-slide-up overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-[var(--alu-border)] flex items-center h-14 px-4">
                <button
                    onClick={onBack}
                    className="text-sm font-medium text-alu-text-secondary hover:text-alu-text transition-colors"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="m15 18-6-6 6-6" />
                    </svg>
                </button>
                <h2 className="flex-1 text-center text-base font-bold text-alu-text">Edit Profile</h2>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="text-sm font-bold text-[var(--alu-primary)] disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>

            <div className="max-w-[500px] mx-auto px-4 py-6">
                {/* Profile Picture */}
                <div className="flex flex-col items-center mb-8">
                    <div className="w-24 h-24 rounded-full bg-alu-surface overflow-hidden mb-3 relative">
                        {avatarToRender && !avatarBroken ? (
                            <img
                                src={avatarToRender}
                                alt="Profile"
                                className="w-full h-full object-cover"
                                onError={() => setAvatarBroken(true)}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-alu-text-secondary">
                                {(displayName || 'U')[0].toUpperCase()}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mb-6 rounded-xl border border-alu-border p-3 bg-white">
                    <p className="text-xs font-semibold text-alu-text-secondary mb-2">Bluesky Profile</p>
                    <p className="text-[11px] text-alu-text-tertiary">
                        Avatar is synced from your Bluesky profile.
                    </p>
                </div>

                {/* Display Name */}
                <div className="mb-6">
                    <label className="text-xs font-semibold text-alu-text-secondary mb-2 block">Display Name</label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        className="w-full h-11 px-4 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow"
                    />
                </div>

                {/* Bio */}
                <div className="mb-6">
                    <label className="text-xs font-semibold text-alu-text-secondary mb-2 block">Bio</label>
                    <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Tell people about yourself..."
                        maxLength={150}
                        className="w-full h-24 p-4 bg-alu-surface rounded-xl text-sm text-alu-text placeholder:text-alu-text-tertiary outline-none resize-none focus:ring-2 focus:ring-[var(--alu-primary-glow)] transition-shadow"
                    />
                    <div className="text-right mt-1">
                        <span className="text-[11px] text-alu-text-tertiary">{bio.length}/150</span>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <p className="text-sm text-[var(--alu-danger)] mb-4">{error}</p>
                )}
            </div>
        </div>
    );
}


