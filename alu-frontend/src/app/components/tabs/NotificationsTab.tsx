'use client';

import { BACKEND_URL } from '@/app/lib/backend';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { NotificationsIcon } from '../icons';
import NotificationItem from '../NotificationItem';
import { Post, StoryNotification, db } from '../../db';
import PostModal from '../PostModal';

interface User {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

interface GroupedNotification {
  type: 'like' | 'comment' | 'follow' | 'comment_like' | 'reply' | 'new_post' | 'mention' | 'story_like' | 'story_reply';
  postId?: string;
  commentId?: string;
  parentCommentId?: string;
  users: User[];
  count: number;
  latestTimestamp: string;
  commentText?: string;
  read: boolean;
}

interface NotificationsTabProps {
  onReadAll?: () => void;
  onViewUser?: (userId: string) => void;
}

export default function NotificationsTab({ onReadAll, onViewUser }: NotificationsTabProps) {
  const { getToken } = useAuth();
  const { userId } = useAuth();
  const [notifications, setNotifications] = useState<GroupedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [openCommentsOnModal, setOpenCommentsOnModal] = useState(false);
  const [actionError, setActionError] = useState('');

  const backendUrl = BACKEND_URL;
  const localStoryNotifs = useLiveQuery(
    () =>
      userId
        ? db.storyNotifications.where('userId').equals(userId).reverse().sortBy('createdAt')
        : Promise.resolve([] as StoryNotification[]),
    [userId]
  );

  useEffect(() => {
    fetchNotifications();
    markAsRead();
  }, [userId]);

  const fetchNotifications = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${backendUrl}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Fetch notifications error:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      await fetch(`${backendUrl}/notifications/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (userId) {
        const unread = await db.storyNotifications.where('userId').equals(userId).and((n) => !n.read).toArray();
        if (unread.length > 0) {
          await db.storyNotifications.bulkPut(unread.map((n) => ({ ...n, read: true })));
        }
      }
      onReadAll?.();
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const handleNotificationClick = async (notification: GroupedNotification) => {
    setActionError('');

    // Handle follow notifications - navigate to profile
    if (notification.type === 'follow') {
      const targetUserId = notification.users?.[0]?.userId;
      if (targetUserId && onViewUser) {
        onViewUser(targetUserId);
      }
      return;
    }

    if (notification.type === 'story_like' || notification.type === 'story_reply') {
      return;
    }

    // For post-related notifications, open the post
    if (notification.postId) {
      try {
        // Try to fetch from Dexie first
        let post = await db.posts.get(notification.postId);

        // If not in Dexie, fetch from backend
        if (!post) {
          const token = await getToken();
          if (!token) return;

          const res = await fetch(`${backendUrl}/posts/${notification.postId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.ok) {
            const data = await res.json();
            post = data.post;
          }
        }

        if (post) {
          setSelectedPost(post);
          setOpenCommentsOnModal(notification.type === 'comment' || notification.type === 'reply' || notification.type === 'comment_like' || notification.type === 'mention');
        } else {
          setActionError('This post is no longer available.');
        }
      } catch (err) {
        console.error('Error loading post:', err);
        setActionError('Failed to load post.');
      }
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-[600px] mx-auto animate-fade-in">
        <div className="px-4 py-4">
          <h2 className="text-xl font-bold text-alu-text">Notifications</h2>
        </div>
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-[var(--alu-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const mergedNotifications: GroupedNotification[] = [
    ...notifications,
    ...((localStoryNotifs || []).map((n) => ({
      type: n.type,
      users: [
        {
          userId: n.actorId,
          displayName: n.actorName,
          avatarUrl: n.actorAvatar || '',
        },
      ],
      count: 1,
      latestTimestamp: new Date(n.createdAt).toISOString(),
      commentText: n.text || '',
      read: !!n.read,
    })) as GroupedNotification[]),
  ].sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());

  return (
    <div className="w-full max-w-[600px] mx-auto animate-fade-in">
      <div className="px-4 py-4 border-b border-[var(--alu-border)]">
        <h2 className="text-xl font-bold text-alu-text">Notifications</h2>
        {actionError && <p className="text-xs text-red-500 mt-1">{actionError}</p>}
      </div>

      {mergedNotifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-alu-surface flex items-center justify-center mx-auto mb-4 text-alu-text-tertiary">
            <NotificationsIcon size={28} />
          </div>
          <p className="text-sm font-semibold text-alu-text mb-1">No notifications yet</p>
          <p className="text-xs text-alu-text-tertiary">We'll let you know when something happens</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--alu-border)]">
          {mergedNotifications.map((notif, index) => (
            <NotificationItem
              key={`${notif.postId}_${notif.type}_${index}`}
              type={notif.type}
              postId={notif.postId}
              commentId={notif.commentId}
              users={notif.users}
              count={notif.count}
              latestTimestamp={notif.latestTimestamp}
              commentText={notif.commentText}
              read={notif.read}
              onClick={() => handleNotificationClick(notif)}
            />
          ))}
        </div>
      )}

      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => {
            setSelectedPost(null);
            setOpenCommentsOnModal(false);
          }}
          onDeleted={() => {
            setSelectedPost(null);
            setOpenCommentsOnModal(false);
          }}
          openComments={openCommentsOnModal}
        />
      )}
    </div>
  );
}

