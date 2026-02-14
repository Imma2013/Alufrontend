'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { NotificationsIcon } from '../icons';
import NotificationItem from '../NotificationItem';
import { Post, db } from '../../db';
import PostModal from '../PostModal';

interface User {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

interface GroupedNotification {
  type: 'like' | 'comment' | 'follow' | 'comment_like' | 'reply' | 'new_post';
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
}

export default function NotificationsTab({ onReadAll }: NotificationsTabProps) {
  const { getToken } = useAuth();
  const [notifications, setNotifications] = useState<GroupedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [openCommentsOnModal, setOpenCommentsOnModal] = useState(false);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    fetchNotifications();
    markAsRead();
  }, []);

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
      onReadAll?.();
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const handleNotificationClick = async (notification: GroupedNotification) => {
    // Handle follow notifications - could navigate to user profile
    if (notification.type === 'follow') {
      // For now, just log it. Could add profile navigation later
      console.log('Follow notification clicked:', notification.users[0]);
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
          setOpenCommentsOnModal(notification.type === 'comment' || notification.type === 'reply' || notification.type === 'comment_like');
        } else {
          alert('This post is no longer available');
        }
      } catch (err) {
        console.error('Error loading post:', err);
        alert('Failed to load post');
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

  return (
    <div className="w-full max-w-[600px] mx-auto animate-fade-in">
      <div className="px-4 py-4 border-b border-[var(--alu-border)]">
        <h2 className="text-xl font-bold text-alu-text">Notifications</h2>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-alu-surface flex items-center justify-center mx-auto mb-4 text-alu-text-tertiary">
            <NotificationsIcon size={28} />
          </div>
          <p className="text-sm font-semibold text-alu-text mb-1">No notifications yet</p>
          <p className="text-xs text-alu-text-tertiary">We'll let you know when something happens</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--alu-border)]">
          {notifications.map((notif, index) => (
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
