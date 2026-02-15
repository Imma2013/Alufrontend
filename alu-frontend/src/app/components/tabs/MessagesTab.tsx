'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth, useUser } from '@clerk/nextjs';
import { db, DMMessage, DMThread } from '../../db';
import { MessagesIcon, SearchIcon } from '../icons';

interface UserResult {
  userId: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
}

interface MessagesTabProps {
  launchRequest?: { user: UserResult; requestId: number } | null;
  onLaunchHandled?: () => void;
  onViewUser?: (userId: string) => void;
}

const formatThreadTime = (date: Date) => {
  const ts = new Date(date).getTime();
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const humanTime = (date: Date) =>
  new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function MessagesTab({ launchRequest, onLaunchHandled, onViewUser }: MessagesTabProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const myUserId = user?.id || '';

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [realtimeTick, setRealtimeTick] = useState(0);
  const [actionError, setActionError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const backendUrl = BACKEND_URL;

  const threads = useLiveQuery(
    () => (myUserId ? db.dmThreads.where('userId').equals(myUserId).reverse().sortBy('lastMessageAt') : Promise.resolve([] as DMThread[])),
    [myUserId]
  );

  const messages = useLiveQuery(
    () => (activeThreadId ? db.dmMessages.where('threadId').equals(activeThreadId).sortBy('createdAt') : Promise.resolve([] as DMMessage[])),
    [activeThreadId]
  );

  useEffect(() => {
    const onResize = () => setIsMobileView(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const connectStream = async () => {
      while (!stopped && myUserId) {
        try {
          const token = await getToken();
          if (!token) {
            await sleep(1500);
            continue;
          }

          const res = await fetch(`${backendUrl}/dm/stream`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'text/event-stream',
            },
            cache: 'no-store',
            signal: controller.signal,
          });

          if (!res.ok || !res.body) throw new Error('DM stream unavailable');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let splitIndex = buffer.indexOf('\n\n');
            while (splitIndex !== -1) {
              const chunk = buffer.slice(0, splitIndex).trim();
              buffer = buffer.slice(splitIndex + 2);
              const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
              if (dataLine) {
                try {
                  const event = JSON.parse(dataLine.slice(6));
                  if (event?.type && event.type !== 'connected') {
                    setRealtimeTick((t) => t + 1);
                  }
                } catch {
                }
              }
              splitIndex = buffer.indexOf('\n\n');
            }
          }
        } catch {
        }

        if (!stopped) await sleep(1500);
      }
    };

    if (myUserId) connectStream();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [backendUrl, getToken, myUserId]);

  useEffect(() => {
    const syncThreads = async () => {
      if (!myUserId) return;
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${backendUrl}/dm/threads`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const mapped: DMThread[] = (data.threads || []).map((thread: any) => ({
          _id: thread._id,
          userId: myUserId,
          participantId: thread.participantId,
          participantName: thread.participantName || 'Alu User',
          participantAvatar: thread.participantAvatar || '',
          lastMessage: thread.lastMessage || '',
          lastMessageAt: new Date(thread.lastMessageAt || Date.now()),
          unreadCount: Number(thread.unreadCount || 0),
        }));
        if (mapped.length > 0) {
          await db.dmThreads.bulkPut(mapped);
        }
      } catch {
      }
    };

    syncThreads();
    const interval = window.setInterval(syncThreads, 8000);
    return () => window.clearInterval(interval);
  }, [backendUrl, getToken, myUserId, realtimeTick]);

  useEffect(() => {
    const syncActiveThreadMessages = async () => {
      if (!myUserId || !activeThreadId) return;
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${backendUrl}/dm/threads/${activeThreadId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const mapped: DMMessage[] = (data.messages || []).map((msg: any) => ({
          _id: msg._id,
          threadId: msg.threadId,
          senderId: msg.senderId,
          text: msg.text || '',
          imageUrl: msg.imageUrl || '',
          createdAt: new Date(msg.createdAt || Date.now()),
          status: msg.status || 'sent',
        }));
        if (mapped.length > 0) {
          await db.dmMessages.bulkPut(mapped);
        }
      } catch {
      }
    };

    if (activeThreadId) syncActiveThreadMessages();
    const interval = window.setInterval(syncActiveThreadMessages, 5000);
    return () => window.clearInterval(interval);
  }, [activeThreadId, backendUrl, getToken, myUserId, realtimeTick]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length, activeThreadId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const token = await getToken();
        const backendUrl = BACKEND_URL;
        const res = await fetch(`${backendUrl}/users/search?q=${encodeURIComponent(search.trim())}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setResults((data.users || []).filter((item: UserResult) => item.userId !== myUserId));
        }
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, getToken, myUserId]);

  const activeThread = useMemo(
    () => (threads || []).find((thread) => thread._id === activeThreadId) || null,
    [threads, activeThreadId]
  );
  const normalizedSearch = search.trim().toLowerCase();
  const sortedThreads = useMemo(
    () =>
      (threads || [])
        .slice()
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [threads]
  );
  const visibleThreads = useMemo(() => {
    if (!normalizedSearch) return sortedThreads;
    return sortedThreads.filter((thread) => {
      const name = (thread.participantName || '').toLowerCase();
      const lastMessage = (thread.lastMessage || '').toLowerCase();
      return name.includes(normalizedSearch) || lastMessage.includes(normalizedSearch);
    });
  }, [normalizedSearch, sortedThreads]);

  const openThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    await db.dmThreads.update(threadId, { unreadCount: 0 });
    try {
      const token = await getToken();
      if (token) {
        await fetch(`${backendUrl}/dm/threads/${threadId}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
    }
  }, [backendUrl, getToken]);

  const startThreadWithUser = useCallback(async (person: UserResult) => {
    if (!myUserId) return;
    setActionError('');
    const existing = await db.dmThreads
      .where('userId')
      .equals(myUserId)
      .and((thread) => thread.participantId === person.userId)
      .first();

    if (existing) {
      await openThread(existing._id);
      setSearch('');
      setResults([]);
      return;
    }

    try {
      const token = await getToken();
      if (token) {
        const res = await fetch(`${backendUrl}/dm/threads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ participantId: person.userId }),
        });
        if (res.ok) {
          const data = await res.json();
          const thread = data.thread;
          await db.dmThreads.put({
            _id: thread._id,
            userId: myUserId,
            participantId: thread.participantId,
            participantName: thread.participantName || person.displayName || 'Alu User',
            participantAvatar: thread.participantAvatar || person.avatarUrl || '',
            lastMessage: thread.lastMessage || '',
            lastMessageAt: new Date(thread.lastMessageAt || Date.now()),
            unreadCount: Number(thread.unreadCount || 0),
          });
          await openThread(thread._id);
        }
      }
    } catch {
      setActionError('Could not start chat right now. Please try again.');
    }

    setSearch('');
    setResults([]);
  }, [backendUrl, getToken, myUserId, openThread]);

  useEffect(() => {
    if (!launchRequest || !myUserId) return;
    void startThreadWithUser(launchRequest.user).finally(() => {
      onLaunchHandled?.();
    });
  }, [launchRequest, myUserId, onLaunchHandled, startThreadWithUser]);

  const uploadImageToCloudinary = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'alu_comments');

    const res = await fetch('https://api.cloudinary.com/v1_1/dqfvkvggd/image/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error('Image upload failed');
    const json = await res.json();
    return json.secure_url || '';
  };

  const onSelectImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    if (selectedImagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(selectedImagePreview);
    }

    const preview = URL.createObjectURL(file);
    setSelectedImageFile(file);
    setSelectedImagePreview(preview);
  };

  const clearSelectedImage = () => {
    if (selectedImagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(selectedImagePreview);
    }
    setSelectedImageFile(null);
    setSelectedImagePreview('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const sendMessage = async () => {
    if (!activeThreadId || !myUserId) return;
    const text = composer.trim();
    if (!text && !selectedImageFile && !selectedImagePreview) return;

    const now = new Date();
    const localImageUrl = selectedImagePreview || '';
    const message: DMMessage = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      threadId: activeThreadId,
      senderId: myUserId,
      text,
      imageUrl: localImageUrl,
      createdAt: now,
      status: 'sent',
    };

    await db.dmMessages.put(message);
    await db.dmThreads.update(activeThreadId, {
      lastMessage: text || (localImageUrl ? 'Photo' : ''),
      lastMessageAt: now,
      unreadCount: 0,
    });
    setComposer('');
    clearSelectedImage();

    try {
      const token = await getToken();
      if (!token) return;

      let uploadedImageUrl = '';
      if (selectedImageFile) {
        setUploadingImage(true);
        uploadedImageUrl = await uploadImageToCloudinary(selectedImageFile);
      }

      const res = await fetch(`${backendUrl}/dm/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, imageUrl: uploadedImageUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        const confirmed = data.message;
        await db.dmMessages.delete(message._id);
        await db.dmMessages.put({
          _id: confirmed._id,
          threadId: confirmed.threadId,
          senderId: confirmed.senderId,
          text: confirmed.text || '',
          imageUrl: confirmed.imageUrl || '',
          createdAt: new Date(confirmed.createdAt || Date.now()),
          status: confirmed.status || 'sent',
        });
      }
    } catch {
      // local-first fallback already persisted optimistic message
    } finally {
      setUploadingImage(false);
    }
  };

  useEffect(() => {
    return () => {
      if (selectedImagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(selectedImagePreview);
      }
    };
  }, [selectedImagePreview]);

  const showThreadOnMobile = isMobileView && !!activeThread;

  return (
    <div className="w-full h-[calc(100vh-120px)] md:h-[calc(100vh-56px)] max-w-[1200px] mx-auto animate-fade-in bg-white md:border-x md:border-[#efefef] flex">
      {!showThreadOnMobile && (
        <section className="w-full md:w-[380px] md:min-w-[380px] border-r border-[#efefef] flex flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-[#efefef]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[20px] font-bold text-[#262626]">Messages</h2>
              {search.trim() && (
                <button
                  onClick={() => {
                    setSearch('');
                    setResults([]);
                  }}
                  className="text-xs font-semibold text-[#0095f6]"
                >
                  Clear
                </button>
              )}
            </div>
            {actionError && <p className="text-xs text-red-500 mb-2">{actionError}</p>}
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8e8e8e]">
                <SearchIcon size={16} />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#efefef] text-sm text-[#262626] placeholder:text-[#8e8e8e] outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {search.trim() && (
              <div className="border-b border-[#efefef]">
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-[#8e8e8e] uppercase">
                  Start new chat
                </p>
                {isSearching && <p className="px-4 py-3 text-xs text-[#8e8e8e]">Searching...</p>}
                {results.map((person) => (
                  <button
                    key={person.userId}
                    onClick={() => startThreadWithUser(person)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#fafafa] transition-colors"
                  >
                    {person.avatarUrl ? (
                      <img src={person.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-[#f2f2f2] text-[#8e8e8e] text-sm font-bold flex items-center justify-center">
                        {(person.displayName || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#262626] truncate">{person.displayName || 'Alu User'}</p>
                      {person.bio && <p className="text-xs text-[#8e8e8e] truncate">{person.bio}</p>}
                    </div>
                  </button>
                ))}
                {!isSearching && results.length === 0 && (
                  <p className="px-4 pb-3 text-xs text-[#8e8e8e]">No users found.</p>
                )}
              </div>
            )}

            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-[#8e8e8e] uppercase">
              Chats
            </p>
            {visibleThreads.map((thread) => (
                <button
                  key={thread._id}
                  onClick={() => openThread(thread._id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    activeThreadId === thread._id ? 'bg-[#fafafa]' : 'hover:bg-[#fafafa]'
                  }`}
                >
                  {thread.participantAvatar ? (
                    <img src={thread.participantAvatar} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#f2f2f2] text-[#8e8e8e] text-sm font-bold flex items-center justify-center">
                      {(thread.participantName || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#262626] truncate">{thread.participantName}</p>
                    <p className="text-xs text-[#8e8e8e] truncate">
                      {thread.lastMessage || 'Start conversation'} . {formatThreadTime(new Date(thread.lastMessageAt))}
                    </p>
                  </div>
                  {thread.unreadCount > 0 && <div className="w-2 h-2 rounded-full bg-[#0095f6]" />}
                </button>
              ))}

            {!search.trim() && (threads || []).length === 0 && (
              <div className="text-center py-16 px-6">
                <div className="w-16 h-16 rounded-full border border-[#dbdbdb] flex items-center justify-center mx-auto mb-4 text-[#8e8e8e]">
                  <MessagesIcon size={28} />
                </div>
                <p className="text-base font-semibold text-[#262626] mb-1">Your messages</p>
                <p className="text-sm text-[#8e8e8e]">Search someone to start chatting</p>
              </div>
            )}
            {search.trim() && results.length > 0 && visibleThreads.length === 0 && (
              <p className="px-4 py-3 text-xs text-[#8e8e8e]">No existing chats match this search.</p>
            )}
          </div>
        </section>
      )}

      <section className={`${showThreadOnMobile ? 'w-full' : 'hidden md:flex'} flex-1 flex-col`}>
        {activeThread ? (
          <>
            <div className="h-[60px] border-b border-[#efefef] px-4 flex items-center gap-3">
              {isMobileView && (
                <button onClick={() => setActiveThreadId(null)} className="text-[#262626]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15,18 9,12 15,6" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => activeThread.participantId && onViewUser?.(activeThread.participantId)}
                className="flex items-center gap-3 text-left"
                title="Open profile"
              >
                {activeThread.participantAvatar ? (
                  <img src={activeThread.participantAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#f2f2f2] text-[#8e8e8e] text-xs font-bold flex items-center justify-center">
                    {(activeThread.participantName || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-[#262626] hover:underline">{activeThread.participantName}</p>
                  <p className="text-xs text-[#8e8e8e]">Active now</p>
                </div>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 bg-white">
              {(messages || []).map((msg) => {
                const mine = msg.senderId === myUserId;
                return (
                  <div key={msg._id} className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-2.5`}>
                    <div
                      className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl ${
                        mine ? 'bg-[#3797f0] text-white rounded-br-md' : 'bg-[#efefef] text-[#262626] rounded-bl-md'
                      }`}
                    >
                      {msg.imageUrl && (
                        <img
                          src={msg.imageUrl}
                          alt=""
                          className="w-full max-w-[220px] rounded-xl mb-2 object-cover"
                        />
                      )}
                      {msg.text && <p className="text-sm leading-snug">{msg.text}</p>}
                      <p className={`text-[10px] mt-1 ${mine ? 'text-white/80' : 'text-[#8e8e8e]'}`}>
                        {humanTime(new Date(msg.createdAt))}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="px-3 py-3 border-t border-[#efefef]">
              {selectedImagePreview && (
                <div className="mb-2.5 relative w-fit">
                  <img src={selectedImagePreview} alt="" className="w-20 h-20 rounded-xl object-cover border border-[#efefef]" />
                  <button
                    onClick={clearSelectedImage}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-black/75 text-white text-[10px] leading-none"
                    aria-label="Remove image"
                  >
                    x
                  </button>
                </div>
              )}
              <div className="h-11 border border-[#dbdbdb] rounded-full flex items-center px-3 gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onSelectImage}
                  className="hidden"
                />
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="text-[#8e8e8e] hover:text-[#262626]"
                  aria-label="Attach image"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21,15 16,10 5,21" />
                  </svg>
                </button>
                <input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Message..."
                  className="flex-1 text-sm text-[#262626] placeholder:text-[#8e8e8e] outline-none bg-transparent"
                />
                <button
                  onClick={sendMessage}
                  disabled={uploadingImage || (!composer.trim() && !selectedImagePreview)}
                  className="text-sm font-semibold text-[#0095f6] disabled:opacity-40"
                >
                  {uploadingImage ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-center px-8">
            <div>
              <div className="w-20 h-20 rounded-full border border-[#dbdbdb] flex items-center justify-center mx-auto mb-4 text-[#8e8e8e]">
                <MessagesIcon size={34} />
              </div>
              <p className="text-xl font-semibold text-[#262626] mb-1">Your messages</p>
              <p className="text-sm text-[#8e8e8e]">Send private photos and messages to a friend.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

