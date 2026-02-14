import Dexie, { Table } from 'dexie';

export interface Post {
  _id: string;  // MongoDB ID — primary key in Dexie (dedup key)
  contentUrl: string;
  safePrompt: string;
  mediaType: 'image' | 'video';
  videoType?: 'short' | 'long';
  is_ai: boolean;
  isLongForm?: boolean;
  timestamp: Date;
  updatedAt?: Date;
  userId: string;
  synced?: number; // 0 = not synced, 1 = synced
  thumbnailUrl?: string;
  likes?: number;
  likedBy?: string[];
  savedBy?: string[];
  originalPrompt?: string;
  caption?: string;
  visibility?: 'everyone' | 'followers' | 'private';
  displayName?: string;  // User's display name (from Clerk)
  avatarUrl?: string;     // User's profile picture URL (from Clerk)
  commentsCount?: number; // Number of comments on this post
  images?: string[];      // Array of image URLs for carousel posts (up to 3 images)
}

export interface SyncState {
  id: string; // 'lastPull'
  timestamp: string; // ISO Date string
}

export interface Story {
  _id: string;
  userId: string;
  imageUrl: string;
  text?: string;
  textColor?: string;
  createdAt: Date;
  expiresAt: Date;
  displayName?: string;
  avatarUrl?: string;
  viewedBy?: string[];
}

export class AluDexie extends Dexie {
  posts!: Table<Post>;
  syncState!: Table<SyncState>;
  stories!: Table<Story>;

  constructor() {
    super('aluDatabase');

    // Only declare the current schema version — no old versions
    // Old databases with ++id primary key will be deleted and recreated (see initDb below)
    this.version(5).stores({
      posts: '_id, mediaType, timestamp, userId, synced, updatedAt',
      syncState: 'id',
      stories: '_id, userId, createdAt, expiresAt'
    });
  }
}

// Create the database instance
export const db = new AluDexie();

/**
 * Initialize the database safely.
 * If an UpgradeError occurs (e.g., from changing primary key), delete the old DB and recreate.
 * Posts will re-sync from the backend via pullChanges() on next load.
 */
export async function initDb(): Promise<void> {
  try {
    await db.open();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (
      errorMsg.includes('UpgradeError') ||
      errorMsg.includes('changing primary key') ||
      errorMsg.includes('Not yet support')
    ) {
      console.warn('Dexie UpgradeError detected — deleting old database and recreating...');
      await db.delete();
      await db.open();
      console.log('Database recreated successfully. Data will re-sync from server.');
    } else {
      throw err; // Re-throw non-upgrade errors
    }
  }
}
