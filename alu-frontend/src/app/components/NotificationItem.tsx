'use client';

interface User {
  userId: string;
  displayName: string;
  avatarUrl: string;
}

interface NotificationItemProps {
  type: 'like' | 'comment' | 'follow' | 'comment_like' | 'reply' | 'new_post' | 'mention' | 'story_like' | 'story_reply';
  postId?: string;
  commentId?: string;
  users: User[];
  count: number;
  latestTimestamp: string;
  commentText?: string;
  read: boolean;
  onClick: () => void;
}

export default function NotificationItem({
  type,
  users,
  count,
  latestTimestamp,
  commentText,
  read,
  onClick,
}: NotificationItemProps) {
  const formatTime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
  };

  const getText = () => {
    const firstUser = users[0]?.displayName || 'Someone';
    const secondUser = users[1]?.displayName;

    if (count === 1) {
      switch (type) {
        case 'like':
          return `${firstUser} liked your post`;
        case 'comment':
          return `${firstUser} commented: ${commentText}`;
        case 'follow':
          return `${firstUser} started following you`;
        case 'comment_like':
          return `${firstUser} liked your comment`;
        case 'reply':
          return `${firstUser} replied: ${commentText}`;
        case 'new_post':
          return `${firstUser} posted a new video`;
        case 'mention':
          return `${firstUser} mentioned you: ${commentText}`;
        case 'story_like':
          return `${firstUser} liked your story`;
        case 'story_reply':
          return `${firstUser} replied to your story: ${commentText}`;
        default:
          return `${firstUser} interacted with your post`;
      }
    }

    if (count === 2) {
      switch (type) {
        case 'like':
          return `${firstUser} and ${secondUser} liked your post`;
        case 'comment_like':
          return `${firstUser} and ${secondUser} liked your comment`;
        case 'story_like':
          return `${firstUser} and ${secondUser} liked your story`;
        default:
          return `${firstUser} and ${secondUser} interacted with your post`;
      }
    }

    const others = count - 1;
    switch (type) {
      case 'like':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} liked your post`;
      case 'comment_like':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} liked your comment`;
      case 'follow':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} started following you`;
      case 'new_post':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} posted new videos`;
      case 'mention':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} mentioned you`;
      case 'story_like':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} liked your story`;
      case 'story_reply':
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} replied to your story`;
      default:
        return `${firstUser} and ${others} ${others === 1 ? 'other' : 'others'} interacted with your post`;
    }
  };

  const renderAvatars = () => {
    const maxVisible = 3;
    const visibleUsers = users.slice(0, maxVisible);

    return (
      <div className="flex -space-x-2 shrink-0">
        {visibleUsers.map((user, index) => (
          <div
            key={`${user.userId}-${index}`}
            className="relative w-10 h-10 rounded-full border-2 border-white overflow-hidden"
            style={{ zIndex: maxVisible - index }}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-alu-surface flex items-center justify-center text-xs font-bold text-alu-text-secondary">
                {(user.displayName || 'U')[0].toUpperCase()}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-alu-surface transition-colors text-left ${
        !read ? 'bg-blue-50/50' : ''
      }`}
    >
      {renderAvatars()}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-alu-text">
          <span className={!read ? 'font-semibold' : ''}>{getText()}</span>
        </p>
        <p className="text-xs text-alu-text-tertiary mt-0.5">{formatTime(latestTimestamp)}</p>
      </div>
      {!read && (
        <div className="w-2 h-2 rounded-full bg-[var(--alu-primary)] shrink-0" />
      )}
    </button>
  );
}
