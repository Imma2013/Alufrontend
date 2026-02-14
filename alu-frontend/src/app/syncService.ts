import { BACKEND_URL } from '@/app/lib/backend';
import { db } from './db';

/**
 * PULL: Get latest changes from server and update Dexie
 */
export async function pullChanges() {
    try {
        // 1. Get last sync time
        const lastSyncState = await db.syncState.get('lastPull');
        const lastSyncTime = lastSyncState?.timestamp || null;

        // 2. Call backend
        const response = await fetch(`${BACKEND_URL}/sync/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSyncTime }),
        });

        if (!response.ok) throw new Error('Pull failed');

        const data = await response.json();
        const { changes, timestamp } = data;

        if (changes.length > 0) {
            console.log(`Pulling ${changes.length} changes from cloud...`);
            // 3. Update Dexie
            const postsToSave = changes.map((p: any) => ({
                ...p,
                synced: 1,
                timestamp: new Date(p.timestamp),
                updatedAt: new Date(p.updatedAt)
            }));

            await db.posts.bulkPut(postsToSave);
        }

        // 4. Update sync state
        await db.syncState.put({ id: 'lastPull', timestamp });
        console.log('Sync Pull Complete');

    } catch (error) {
        console.error('Sync Pull Error:', error);
    }
}

/**
 * PUSH: Send local unsynced changes to server
 * @param token Clerk Auth Token
 */
export async function pushChanges(token: string) {
    try {
        // 1. Find unsynced posts
        const unsyncedPosts = await db.posts.where('synced').equals(0).toArray();

        if (unsyncedPosts.length === 0) return;

        console.log(`Pushing ${unsyncedPosts.length} changes to cloud...`);

        // 2. Call backend
        const response = await fetch(`${BACKEND_URL}/sync/push`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ changes: unsyncedPosts }),
        });

        if (!response.ok) throw new Error('Push failed');

        // 3. Mark as synced locally
        const updatedPosts = unsyncedPosts.map(p => ({ ...p, synced: 1 }));
        await db.posts.bulkPut(updatedPosts);

        console.log('Sync Push Complete');

    } catch (error) {
        console.error('Sync Push Error:', error);
    }
}

