# Project Alu - Context & Progress

## Project Overview
**Project Name:** Alu
**Vision:** YouTube + TikTok + Facebook + AI
**Goal:** A next-gen social network combining long-form video, short-form video, and photos with AI/Human content coexistence and local-first architecture.

## Repos
- **Backend:** https://github.com/Imma2013/Alubackend.git (deployed on Render)
- **Frontend:** https://github.com/Imma2013/Alufrontend.git (deploy to Vercel)

## Current Structure
```
alu-backend/    (Node.js + Express) — ON RENDER, WORKING
alu-frontend/   (Next.js + Tailwind) — ON VERCEL, DEPLOYED (alu-teal-pi.vercel.app)
```

## Tech Stack

### Frontend
- Next.js 16 + Tailwind CSS 4
- Clerk Auth (@clerk/nextjs)
- Dexie.js (IndexedDB for local-first)
- OPFS (local media storage)
- Font: Plus Jakarta Sans
- Brand color: Amber/Gold (#D4A017)

### Backend
- Node.js + Express
- MongoDB Atlas
- Stripe (payments)
- PostHog (analytics)

### AI Services
- NanoBanana Flash / `gemini-2.0-flash-preview-image-generation` (images — via Gemini API generateContent, switched from Pro for speed)
- Veo 3.1 / `veo-3.1-generate-preview` → fallback Veo 2.0 / `veo-2.0-generate-001` (shorts — via Gemini API generateVideos)
- Sora 2 via piapi.ai (long video clips — storyboard mode, falls back to Veo 3.1)
- Gemini Flash 2.0 as orchestrator/prompt cleaner + scene splitter (conductor.js)
- FFmpeg via ffmpeg-static (video stitching/concatenation)

## Content Limits (Freemium)
| Content Type | Free Tier | Pro ($10/mo) |
|--------------|-----------|--------------|
| Manual Upload | Unlimited | Unlimited |
| AI Images | 3/day | 30/day |
| AI Shorts | 0 (Pro-only) | 5/month |
| AI Long Videos | Disabled | Disabled |

### Monetization
- **Pro subscription:** $10/month via Stripe — 30 AI images/day + 5 AI shorts/month
- **Credit pack (one-time):** $10 — +50 AI images (bonus credits, don't reset daily)

---

## Milestones

### Phase 1: Foundation (COMPLETED)
- Backend scaffolded with Express
- Frontend scaffolded with Next.js
- Clerk authentication integrated
- Dexie.js and OPFS configured
- Basic AI Orchestra (conductor.js)

### Phase 2: Full Frontend Redesign (IN PROGRESS — UI SHELL COMPLETE)
- [x] Complete app shell with tab-based navigation
- [x] Desktop: Left sidebar (240px) with nav items + Create button
- [x] Mobile: Bottom nav (Home | Shorts | + Create | Videos | Profile)
- [x] Mobile: Top bar (Logo | Search icon | AI/Normal | Notifications | Messages)
- [x] Desktop: Sticky header with Search icon + AI/Normal toggle
- [x] Search bar: Instagram-style — hidden by default, tap search icon to expand, X to close
- [x] Home tab: Stories row + Facebook-style feed with mock data
- [x] Shorts tab: TikTok-style fullscreen vertical video player
- [x] Videos tab: YouTube-style grid layout with thumbnails
- [x] Messages tab: Search + stories + conversation list
- [x] Create tab: Upload + AI generation with type selector (Image/Short/Video)
- [x] Profile tab: Avatar, stats, content tabs (Posts/Shorts/Videos/Likes/Favorites)
- [x] Notifications tab: Grouped by read/unread
- [x] Icons component library (SVG, line + filled variants)
- [x] CSS design system with custom properties
- [x] Build passes (Next.js 16 + TypeScript)

### Phase 2b: Polish & Backend Wiring (DONE 2026-02-09 session 2)
- [x] Removed ALL emojis — replaced with SVG icons (ImageIcon, ZapIcon, FilmIcon, UploadIcon, etc.)
- [x] AI/Normal toggle is now INDEPENDENT toggles (not radio buttons)
  - Both on = mixed feed (default)
  - AI only = tap Normal off
  - Normal only = tap AI off
  - At least one must stay on
- [x] Profile tab now has its own AI/Normal filter below content tabs
- [x] Create tab wired to REAL backend (calls POST /generate, saves to OPFS + Dexie)
- [x] Privacy selector uses clean icon buttons (Globe/Users/Lock) instead of emoji dropdown
- [x] Settings dropdown uses SVG icons (Settings, Lock, LogOut)
- [x] Notifications uses SVG icons (Heart, Profile, Comment, Share) instead of emoji

### Phase 2 — STILL TODO (Wire up real data):
- [x] Connect HomeTab Feed to real Dexie data (done Session 4)
- [x] Pass showAI/showNormal from page.tsx down to feed tabs (done Session 4)
- [x] Connect search to actually search content (done Session 8)
- [x] Hook up Clerk UserButton to Profile tab (done Session 6)
- [x] Replace mock data with real Dexie queries in all tabs (done Session 5)
- [x] Add real image/video display using MediaItem.tsx + OPFS (done Session 4)
- [x] Wire up like/comment/share/bookmark to backend (done Session 8 + Session 10 fixes)
- [ ] Implement story upload/display
- [ ] Messages: Real-time messaging (not implemented yet)
- [ ] Image cropping on upload (keep it simple like Instagram)

### Phase 3: Polish & Ship
- [x] Fix Stripe webhook — complete with subscription + one-time credit pack support (Session 10)
- [x] Follow/unfollow system — backend + frontend wired (Session 10)
- [x] Delete own posts — PostModal + API (Session 10)
- [x] Instagram PostModal redesign — side-by-side with inline comments (Session 10)
- [ ] Add referral system
- [ ] PWA manifest + service worker
- [ ] Test end-to-end
- [ ] Performance optimization

---

## File Structure (Frontend)

```
alu-frontend/src/app/
├── globals.css              — Design system (CSS vars, animations, scrollbar)
├── layout.tsx               — Root layout (ClerkProvider, Plus Jakarta Sans font)
├── page.tsx                 — MAIN APP SHELL (sidebar, bottom nav, tab routing)
├── db.ts                    — Dexie database schema (posts, syncState)
├── fileSystem.ts            — OPFS helpers (save/get files)
├── syncService.ts           — REST sync (pull/push to backend)
└── components/
    ├── icons.tsx             — SVG icon components (Home, Shorts, Videos, Shield, FileText, etc.)
    ├── Feed.tsx              — Original feed component (uses Dexie live query)
    ├── GenerationForm.tsx    — AI generation form (calls backend /generate)
    ├── MediaItem.tsx         — Displays media from OPFS + Cloudinary URLs
    ├── PostModal.tsx          — Instagram-style post expand overlay (media + actions)
    ├── CommentsPanel.tsx      — TikTok-style slide-up comments panel (CRUD via API)
    ├── PrivacyPolicy.tsx     — Full-page privacy policy overlay
    ├── TermsConditions.tsx   — Full-page terms & conditions overlay
    └── tabs/
        ├── HomeTab.tsx       — Real Dexie feed with like API, comments, people search
        ├── ShortsTab.tsx     — TikTok-style vertical player (real Dexie data)
        ├── VideosTab.tsx     — YouTube-style grid (real Dexie data)
        ├── MessagesTab.tsx   — User search by name (messaging coming soon)
        ├── CreateTab.tsx     — Upload + AI generate with displayName/avatarUrl
        ├── ProfileTab.tsx    — Real user profile + Privacy/Terms overlays
        └── NotificationsTab.tsx — Empty state (backend ready, frontend pending)
├── post/[id]/page.tsx       — Share link page (media + comments + like/share)
├── watch/[id]/page.tsx      — YouTube-style watch page (video player + comments + related)
├── success/page.tsx         — Stripe payment success page (auto-redirect)
├── global-error.tsx         — Custom global error boundary (fixes Next.js 16 build)
```

## Design System

### Brand
- **Logo:** "alu" — lowercase, extrabold, Plus Jakarta Sans
- **Primary color:** #D4A017 (amber/gold)
- **Primary light:** #F5D060
- **Primary dark:** #B8860B
- **Background:** #FFFFFF (pure white)
- **Text:** #1A1A1A
- **Text secondary:** #737373
- **Border:** #E8E8E8
- **Surface (cards/inputs):** #F5F5F5

### Layout
- Desktop sidebar: 240px fixed left
- Mobile header: 56px fixed top
- Mobile bottom nav: 64px fixed bottom (with iOS safe area)
- Sticky header: Shows on Home, Shorts, Videos, Profile tabs (NOT Messages, Create, Notifications)

### Key UI Patterns
- AI/Normal toggle: Pill-shaped toggle, active state = amber background + white text
- Create button: Gradient amber, pulse glow animation
- Stories: Horizontal scroll, gradient ring for unseen
- AI badge: Shows on the CONTENT itself (overlay on image/video), NOT next to usernames
- Search: Instagram-style — just an icon in the header, expands into full search bar on tap, X to collapse
- Content filter: AI badge on content thumbnails (dark pill with "AI" text, top-left corner)

---

## Existing Backend Logic (READY TO WIRE UP)
These files in the frontend already have working logic — they just need to be integrated into the new tab components:

1. **GenerationForm.tsx** — Full AI generation flow:
   - Calls `POST /generate` with prompt + type
   - Downloads result to OPFS
   - Saves to Dexie with `synced: 1`
   - Has loading state + error handling

2. **Feed.tsx** — Live feed from Dexie:
   - Uses `useLiveQuery` for real-time updates
   - Has AI/Human filter
   - Runs sync on mount (pull + push)
   - Polls every 60 seconds

3. **MediaItem.tsx** — Displays OPFS media:
   - Gets blob URL from OPFS file handle
   - Handles images + videos
   - Shows loading placeholder
   - Revokes blob URLs on unmount

4. **db.ts** — Dexie schema (v4):
   - Posts table: _id (primary key = MongoDB ObjectId), mediaType, timestamp, userId, synced, updatedAt
   - SyncState table: tracks last pull timestamp

5. **syncService.ts** — REST sync:
   - `pullChanges()` — POST /sync/pull, bulk puts to Dexie
   - `pushChanges(token)` — POST /sync/push, marks as synced

---

## Environment Variables Needed
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<clerk key>
CLERK_SECRET_KEY=<clerk secret>
NEXT_PUBLIC_BACKEND_URL=<render backend url>
```

## Deployment Notes
- Backend is on Render (working)
- Frontend is on Vercel (deployed at alu-teal-pi.vercel.app)
- `force-dynamic` is set in layout.tsx (required for Clerk + Next.js 16)
- Build command: `npm run build`
- Output: `.next` directory (standard Next.js)
- Env vars on Vercel: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, NEXT_PUBLIC_BACKEND_URL

---

## Business Model

### Freemium Tiers
| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 3 img / 2 shorts / 1 vid per day |
| Pro | $10/mo (Stripe subscription) | 10x daily limits (30 img / 20 shorts / 10 vids) |
| Credit Pack | $10 one-time (Stripe) | +50 images, +20 shorts, +10 videos (bonus, don't reset daily) |

### Why Local-First Saves Money
- Users store media on THEIR device (OPFS)
- Backend only handles: metadata sync, AI API calls, hosting
- 10,000 users = minimal cloud storage costs

---

## Session Log

### 2026-02-08: Foundation Fixes (Claude)
- Fixed missing dexie and dexie-react-hooks dependencies
- Fixed imports (components-v2/Feed → components/Feed)
- Cleaned corrupted CONTEXT.md
- Build passes

### 2026-02-09: Full Frontend Redesign (Claude Opus)
- Built complete app shell with tab-based navigation
- Desktop: Left sidebar with all nav items + gradient Create button
- Mobile: Facebook-style top bar + TikTok-style bottom nav
- All 7 tabs built with mock data (Home, Shorts, Videos, Messages, Create, Profile, Notifications)
- Design system: Amber/gold brand color, Plus Jakarta Sans font, white bg
- Icons library: 14 SVG icons with active/inactive variants
- CSS: Custom properties, animations (fadeIn, slideUp, pulseGlow), scrollbar styling
- Build passes on Next.js 16 + TypeScript
- Pushed to https://github.com/Imma2013/Alufrontend.git

### 2026-02-09: Polish & Backend Wiring (Claude Opus, session 2)
- Removed all emojis from UI, replaced with SVG icon components
- AI/Normal toggle changed to independent toggles (both can be active)
- Profile tab gets its own AI/Normal filter for content grid
- Create tab now wired to real backend (POST /generate → OPFS → Dexie)
- Added 8 new SVG icons: ImageIcon, FilmIcon, ZapIcon, UploadIcon, GlobeIcon, LockIcon, UsersIcon, LogOutIcon
- Privacy options changed from emoji dropdown to icon buttons
- NotificationsTab uses SVG icons instead of emoji
- Cleaned emoji from all mock data strings
- Build passes

### 2026-02-09: UX Polish — Session 3 (Claude Opus)
- Search bar changed to Instagram-style: icon only, expands on tap, X to close (both mobile + desktop)
- AI badge REMOVED from next to usernames in feed (was next to profile name, users don't want that)
- AI badge now shows on the CONTENT itself (overlay on image/video, top-left corner, dark pill)
- Profile grid still has AI badge on thumbnails (unchanged, this is correct)
- CONTEXT.md fully updated with all changes
- User feedback: 6 positive reviews from testers, 2 people lined up to upload real videos
- Frontend deployed on Vercel at alu-teal-pi.vercel.app

### 2026-02-09: LAUNCH DAY — Session 4 (Claude Opus)
**Backend:**
- NEW: POST /upload endpoint (Cloudinary + Multer) — users can upload photos/videos up to 100MB
- Cloudinary: auto CDN delivery, video thumbnails via eager transform, 25GB free tier
- Simple rate limiter (10 req/min per IP) on upload endpoint
- Added thumbnailUrl to PostSchema
- Installed: multer, cloudinary

**Frontend — Real Data:**
- HomeTab: replaced ALL mock posts with real Dexie live queries (useLiveQuery)
- HomeTab: syncs on mount + every 60s (pullChanges + pushChanges)
- HomeTab: receives showAI/showNormal props from page.tsx — filtering works
- ProfileTab: shows user's OWN posts from Dexie, filtered by userId from Clerk
- ProfileTab: uses Clerk useUser() for real name, avatar, post count
- CreateTab: Upload mode fully wired — file picker, preview, FormData POST to /upload, saves to OPFS + Dexie
- MediaItem: handles both OPFS local files (own content) and Cloudinary URLs (synced content from others)
- Added saveFileFromBlob() to fileSystem.ts for direct File-to-OPFS save

**UX/Design:**
- SVG logo: AluLogo component (wordmark with spark accent) + AluMark (compact icon mark)
- ShortsTab: vertical swipe gestures (touch start/move/end) like TikTok + mouse wheel on desktop
- Profile tab: search bar + AI/Normal toggles hidden in header (Instagram behavior)
- Dexie schema v3: added videoType, thumbnailUrl, likes, originalPrompt to Post interface

**Deployed:**
- Frontend pushed to Alufrontend.git main → Vercel auto-deploy
- Backend pushed to Alubackend.git main → Render auto-deploy
- User needs to add Cloudinary env vars on Render: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

### 2026-02-10: Launch Polish — Session 5 (Claude Opus)
**AI Content Self-Label:**
- Added "AI Generated" toggle button in CreateTab upload mode (below file preview, before caption)
- isAI state defaults to false, resets on clearFile() and successful upload
- FormData sends is_ai: 'true'/'false' to backend
- Backend uploadRoutes.js now reads is_ai from req.body (was hardcoded false)

**Mock Data Removal — ALL fake usernames/data removed:**
- HomeTab: removed MOCK_STORIES array + entire stories row + divider
- ShortsTab: removed MOCK_SHORTS, now uses useLiveQuery from Dexie (mediaType=video, videoType=short)
- ShortsTab: removed white scroll indicator (the right-side dots)
- ShortsTab: shows real video content via MediaItem, empty state when no shorts
- VideosTab: removed MOCK_VIDEOS, now uses useLiveQuery from Dexie (videoType=long)
- VideosTab: shows real thumbnails via thumbnailUrl or MediaItem, empty state when no videos
- MessagesTab: removed MOCK_STORIES + MOCK_CONVERSATIONS, shows empty state with search bar (kept for future)
- NotificationsTab: removed MOCK_NOTIFICATIONS + NotifIcon helper, shows empty state

**Privacy Policy + Terms & Conditions:**
- NEW: PrivacyPolicy.tsx — full-page overlay with back button, scrollable content, user's drafted text
- NEW: TermsConditions.tsx — same pattern, user's Terms text including AI liability clauses
- ProfileTab settings dropdown: removed "Settings" text button, now shows Privacy / Terms & Conditions / Log Out
- Clicking Privacy or Terms opens the respective full-page overlay

**Sign-In Screen:**
- page.tsx: imports useUser + SignInButton from @clerk/nextjs
- If user not signed in: shows Alu logo + "Welcome to Alu" + sign-in button (modal mode)
- Prevents unauthenticated users from seeing the app shell

**New Icons:**
- ShieldIcon (privacy, shield outline) added to icons.tsx
- FileTextIcon (terms, document with lines) added to icons.tsx

**Build:** passes clean on Next.js 16 + TypeScript

### 2026-02-10: Fix Everything + Video Stitching — Session 6 (Antigravity)

**Phase 0 — Restored Missing Frontend Scaffolding:**
- 8 critical files were missing from git (never committed): package.json, layout.tsx, globals.css, syncService.ts, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs
- Copied from Claude worktree, added NEXT_PUBLIC_BACKEND_URL to .env.local
- npm install + npm run build passes

**Phase 1 — Fixed Broken UI Features:**
- Log Out: added `signOut()` handler via `useClerk()` in ProfileTab.tsx
- Edit Profile: NEW EditProfile.tsx overlay — edit display name, bio (stored in Clerk unsafeMetadata), profile photo upload
- Share Profile: copies profile link to clipboard with "Copied!" toast
- Removed 4 fake notification/message badges from page.tsx (mobile + desktop)
- Profile shows real bio from Clerk `unsafeMetadata.bio`

**Phase 2 — Fixed AI Generation (conductor.js rewrite):**
- Images: NanoBanana Pro (`gemini-3-pro-image-preview`) via `generateContent` with `responseModalities: ['IMAGE']` → base64 → Cloudinary upload
- Shorts: Veo 3.1 (`veo-3.1-generate-preview`) via `generateVideos` → async polling → Cloudinary upload
- Long videos: redirects to stitching pipeline (POST /generate/long-video)
- Added `visibility` field to PostSchema (everyone/followers/private)
- Added `caption`, `status` fields to PostSchema
- Privacy/visibility wired end-to-end: CreateTab → backend → database → feed filtering
- NEW: GET /usage endpoint — returns real daily usage counts + limits
- CreateTab shows real remaining counts (not hardcoded)
- Sync pull now filters by visibility: 'everyone' only
- Feed endpoint filters by visibility: 'everyone' only

**Phase 3 — 5-Minute Video Stitching Pipeline:**
- NEW: services/videoJobs.js — in-memory job queue with status tracking (queued → splitting_scenes → generating_clips → stitching → uploading → complete/failed)
- NEW: services/videoStitcher.js — full pipeline:
  1. Gemini Flash splits prompt into N scene descriptions
  2. Sora 2 (piapi.ai) generates each 8s clip (falls back to Veo 3.1)
  3. FFmpeg (via ffmpeg-static npm package) concatenates clips
  4. Cloudinary uploads final video
- NEW: POST /generate/long-video — creates background job, returns jobId
- NEW: GET /generate/status/:jobId — real-time progress polling (auth-protected)
- CreateTab: long video mode uses polling with visual progress bar (percentage + step label)
- Installed: uuid, ffmpeg-static

**New Files:**
- alu-frontend/src/app/components/EditProfile.tsx
- alu-backend/services/videoJobs.js
- alu-backend/services/videoStitcher.js

**Modified Files:**
- alu-backend/services/conductor.js (full rewrite — NanoBanana Pro + Veo 3.1)
- alu-backend/config/db.js (PostSchema: visibility, caption, status)
- alu-backend/server.js (usage endpoint, long-video endpoints, visibility filtering)
- alu-backend/routes/uploadRoutes.js (visibility + caption)
- alu-backend/routes/syncRoutes.js (visibility-filtered pull)
- alu-frontend/src/app/page.tsx (removed fake badges)
- alu-frontend/src/app/db.ts (Post interface: visibility, caption)
- alu-frontend/src/app/components/tabs/ProfileTab.tsx (signOut, edit profile, share, real bio)
- alu-frontend/src/app/components/tabs/CreateTab.tsx (visibility, usage, long video progress)

**Build:** Frontend passes `npm run build`, backend passes all syntax checks

### 2026-02-10: Bug Fixes + Post Modal — Session 7 (Claude Opus)

**Fix 1 — Duplicate Posts (Critical):**
- Root cause: Dexie used `++id` (auto-increment) as primary key — `bulkPut` from sync couldn't match MongoDB `_id`, creating duplicate rows
- Changed Dexie primary key from `++id` to `_id` (MongoDB ObjectId string)
- Bumped Dexie schema to version 4 (kept v3 declaration for upgrade path)
- Changed all `db.posts.add()` → `db.posts.put()` (upsert) in CreateTab.tsx
- Removed `id?: number` from Post interface — `_id: string` is now required
- Fixed all `post._id || String(post.id)` fallbacks → just `post._id` in ShortsTab, VideosTab, HomeTab

**Fix 2 — Instagram-Style Post Expand Modal:**
- NEW: PostModal.tsx — fullscreen overlay with dark backdrop + white card
- Shows MediaItem (image/video), action bar (like/comment/share/save), caption, timestamp
- Close via X button or clicking backdrop
- Share uses `navigator.share()` on mobile + `navigator.clipboard.writeText()` fallback
- Wired into HomeTab (click media to expand) and ProfileTab (click grid item)

**Fix 3 — Shorts 500 Error (Veo Model Fallback):**
- Root cause: `veo-3.1-generate-preview` returns 500 (model not available on API key)
- Added fallback chain: tries Veo 3.1 first, falls back to `veo-2.0-generate-001`
- Uses for-loop with try/catch per model — breaks on first success
- Logs which model succeeded/failed for debugging

**Fix 4 — Share Button on Posts:**
- Wired ShareIcon button in HomeTab to `handleShare()` function
- Uses Web Share API (`navigator.share()`) on mobile devices
- Falls back to `navigator.clipboard.writeText()` on desktop
- Share URL format: `{origin}/post/{post._id}`

**Modified Files:**
- alu-frontend/src/app/db.ts (primary key `_id`, removed `id`, version 4)
- alu-frontend/src/app/components/tabs/CreateTab.tsx (`add` → `put`)
- alu-frontend/src/app/components/tabs/HomeTab.tsx (PostModal, share, key fix)
- alu-frontend/src/app/components/tabs/ProfileTab.tsx (PostModal, key fix)
- alu-frontend/src/app/components/tabs/ShortsTab.tsx (key fix: removed `.id` ref)
- alu-frontend/src/app/components/tabs/VideosTab.tsx (key fix: removed `.id` ref)
- alu-backend/services/conductor.js (Veo 3.1 → 2.0 fallback chain)

**New Files:**
- alu-frontend/src/app/components/PostModal.tsx

**Build:** Frontend passes `npm run build` clean (Next.js 16 + TypeScript)

### 2026-02-10: Critical Fixes — Session 8 (Claude Opus)

**Fix 1 — Dexie UpgradeError (BLOCKER):**
- Root cause: Session 7 changed Dexie primary key from `++id` to `_id`, but Dexie cannot change primary keys via version upgrade — causes "UpgradeError: Not yet support for changing primary key" on any browser with existing data
- Fix: Removed version(3) declaration, added `initDb()` function that wraps `db.open()` in try/catch — if UpgradeError, deletes old database and recreates fresh
- Posts re-sync from backend via `pullChanges()` on next load (no data loss since all posts are in MongoDB)
- Added `displayName` and `avatarUrl` to Post interface (prep for Phase 3)
- Called `initDb()` in page.tsx useEffect on mount

**Fix 2 — Merged Other AI Session (Likes, Comments, Share Pages, User Profiles):**
Merged uncommitted work from another Claude session that built core social features:

*Backend — New Routes + Schemas:*
- NEW: `routes/postRoutes.js` — GET post by ID, POST like/unlike (with `likedBy` array), GET/POST/DELETE comments, auto-creates Notification on like/comment
- NEW: `routes/notificationRoutes.js` — GET notifications, POST mark-all-read, GET unread-count
- NEW: `routes/userRoutes.js` — GET `/users/search?q=name` (regex search), GET `/users/:userId` (public profile + post counts)
- `config/db.js` — Added Comment + Notification schemas, `likedBy`/`displayName`/`avatarUrl` on PostSchema, `displayName`/`avatarUrl`/`bio` on UserSchema, stale `email_1` index auto-cleanup on startup
- `server.js` — Mounted `/posts`, `/notifications`, `/users` routes, passes displayName/avatarUrl to conductor + long-video, added `/generate/short-video` endpoint
- `services/conductor.js` — Accepts displayName/avatarUrl params, syncs them to User record on each generation

*Frontend — New Pages + Components:*
- NEW: `components/CommentsPanel.tsx` — TikTok-style slide-up panel, fetches/posts/deletes comments via API, displays user avatars + names
- NEW: `/post/[id]/page.tsx` — Share link page: fetches post by ID from backend, renders media + user info + like/comment/share buttons + comments sidebar
- NEW: `/watch/[id]/page.tsx` — YouTube-style watch page: video player (16:9 or 9:16), expandable description, comments section, related videos sidebar

*Frontend — Modified Tabs:*
- `HomeTab.tsx` — Like button calls `POST /posts/:id/like` API (tracks likedByMe + real count), comment button opens CommentsPanel, people search in feed (debounced), real avatars/names from post data
- `CreateTab.tsx` — Sends `user.fullName` + `user.imageUrl` with every upload and AI generation request
- `MessagesTab.tsx` — Upgraded from empty state to user search (search people by name via `/users/search`)
- `uploadRoutes.js` — Stores displayName/avatarUrl on uploaded posts

*Bug Fixes Applied:*
- Fixed import path in `postRoutes.js` and `notificationRoutes.js`: `require('../middleware/auth')` → `require('../middleware/clerkAuth')` (wrong file name + wrong destructure)
- Wired `searchQuery` prop from page.tsx to HomeTab for search functionality
- Kept our `db.ts` (with `initDb()` for Dexie UpgradeError handling) and `page.tsx` (with `initDb()` call on mount)

**Build:** Frontend passes `npm run build` clean — routes: `/`, `/post/[id]`, `/watch/[id]`
**Pushed:** Backend → `b26f651` on Alubackend.git | Frontend → `f73e401` on Alufrontend.git

### 2026-02-11: Feed UX, Profile Viewing, Video Pause — Session 9 (Claude Opus)

**1. Removed Messages Tab (deferred to future):**
- Removed MessagesTab import, nav entry, and rendering from `page.tsx`
- MessagesTab.tsx file kept for later — user said "we will add that later"

**2. View Other Users' Profiles:**
- `page.tsx`: Added `viewUserId` state, `handleViewUser()` callback, `handleTabChange()` (clears viewUserId on non-profile tabs), passes `onViewUser` to HomeTab and ProfileTab
- `ProfileTab.tsx`: Dual-mode — own profile (Clerk data, Dexie posts, Edit Profile, Settings) vs other user (fetches `GET /users/:userId` for profile data, `POST /sync/pull` filtered by userId for their posts, back arrow, "Follow (Coming Soon)" greyed button, no settings/edit/logout)

**3. Clickable Names/Avatars in Feed:**
- `HomeTab.tsx`: Added `onViewUser` prop. People search results now navigate to profile on click. Post header avatar + displayName wrapped in clickable `<button>` with `hover:underline`. Passes `onViewUser` to PostModal.

**4. PostModal Improvements:**
- `PostModal.tsx`: Added user info section (clickable avatar + name → opens profile + closes modal). Like button now calls real API (`POST /posts/:id/like`) with auth token. Comment button opens embedded CommentsPanel. Added `onViewUser` prop.

**5. Tap-to-Pause on Shorts:**
- `ShortsTab.tsx`: Tap video area → toggles pause/play via DOM query for `<video>`. Pause indicator: translucent circle with play icon in center. Resets on swipe to new short. Also fixed avatar/displayName display (was showing raw userId).

**6. VideosTab → Watch Page:**
- `VideosTab.tsx`: Added `useRouter`, click on video thumbnail navigates to `/watch/[id]`. Fixed avatar/displayName display (was showing raw userId).

**Build:** Frontend passes `npm run build` clean — routes: `/`, `/post/[id]`, `/watch/[id]`

### 2026-02-11: Fix Everything & Ship — Session 10 (Claude Opus)

**Backend Fixes:**
- **Image model switched:** `gemini-3-pro-image-preview` (Pro, slow) → `gemini-2.0-flash-preview-image-generation` (Flash, fast). Label: "NanoBanana Flash"
- **DELETE post endpoint:** `DELETE /posts/:id` — verifies ownership, deletes post + comments + notifications + Cloudinary asset. Full cleanup.
- **Stripe payments completed:** Both subscription ($10/mo Pro) and one-time ($10 credit pack) modes. Webhook handles `checkout.session.completed` (sets isPro or adds bonus credits) and `customer.subscription.deleted` (downgrades). Credit pack: +50 images, +20 shorts, +10 videos.
- **Fixed /usage 500 error:** Changed from `findOne` (returns null, crashes) to `findOneAndUpdate` with `upsert: true`. Returns bonus credits + Pro-scaled limits.
- **Follow/unfollow endpoints:** `POST /users/:userId/follow` and `/unfollow` — updates both users' followers/following arrays, creates notification on follow.
- **User profile endpoint updated:** Returns real `followersCount`, `followingCount`, `followers[]`, `following[]`.
- **Schema updates (db.js):** Added `bonusImages`, `bonusShorts`, `bonusLongVids` (Number, default 0), `followers` [String], `following` [String] to UserSchema. Added `'follow'` to Notification type enum.
- **Daily limit system upgraded:** Pro users get 10x limits. Bonus credits stack on top. Formula: `baseLimit * proMultiplier + bonusCredits`.

**Frontend Fixes:**
- **Caption moved below media:** YouTube/Instagram-style — new order: Header → Media → Actions → Caption (was above media).
- **Instagram PostModal redesign:** Side-by-side layout on desktop (60% media left, 40% info right). Mobile: stacked. Inline comments (fetched on open). Comment input at bottom of right panel. Caption shown as first "comment" (Instagram-style).
- **Like button fixed:** `likedByMe` Set now initialized from `post.likedBy` array on posts load (was empty, so first click always showed "like" even if already liked). Like count initialized from `post.likes`.
- **Delete own posts:** Trash icon in PostModal header (only for post owner). Confirmation dialog. Deletes via `DELETE /posts/:id`, removes from Dexie, closes modal, calls `onDeleted` callback to refresh parent.
- **Follow system:** Real Follow/Unfollow button on other user profiles. Shows real follower/following counts from API. Button state derived from `profile.followers.includes(user.id)`.
- **Upgrade to Pro:** Settings dropdown → "Upgrade to Pro" option. Modal with two choices: Pro Monthly ($10/mo) or Credit Pack ($10 one-time). Redirects to Stripe Checkout.
- **Stripe success page:** `/success` — shows checkmark + "Payment Successful!" + 3-second countdown redirect to `/`.
- **`likedBy` added to Post interface** in db.ts for type safety.
- **Custom global-error.tsx** — fixes Next.js 16 prerender error during build.

**New Files:**
- `alu-frontend/src/app/success/page.tsx` — Stripe payment success page
- `alu-frontend/src/app/global-error.tsx` — Custom error boundary (fixes build)

**Modified Files (Backend):**
- `alu-backend/services/conductor.js` — Flash model, Pro multiplier + bonus credits in limit check
- `alu-backend/routes/postRoutes.js` — DELETE post endpoint with Cloudinary cleanup
- `alu-backend/routes/paymentRoutes.js` — Complete rewrite: both payment modes, full webhook
- `alu-backend/routes/userRoutes.js` — Follow/unfollow endpoints, real follower counts
- `alu-backend/config/db.js` — Bonus credits, followers/following, follow notification type
- `alu-backend/server.js` — Fixed /usage upsert, bonus credits in response

**Modified Files (Frontend):**
- `alu-frontend/src/app/components/tabs/HomeTab.tsx` — Caption below, like state init
- `alu-frontend/src/app/components/PostModal.tsx` — Instagram redesign, inline comments, delete, like fix
- `alu-frontend/src/app/components/tabs/ProfileTab.tsx` — Follow, upgrade modal, delete support
- `alu-frontend/src/app/db.ts` — likedBy on Post interface

**Build:** Frontend passes `npm run build` clean — routes: `/`, `/_not-found`, `/post/[id]`, `/success`, `/watch/[id]`

**ENV VARS NEEDED:**
- Vercel: `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID`, `NEXT_PUBLIC_STRIPE_CREDIT_PRICE_ID` (create Price objects in Stripe Dashboard first)
- Render: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`

### 2026-02-12: Comments System + Notifications + Favorites — Session 11 (Haiku)

**Backend — Comment Replies + Images:**
- **Comment Schema updated:** Added `parentCommentId` (for nested replies), `imageUrl` (for comment image attachments)
- **Notification Schema updated:** Added `'comment_like'` and `'reply'` to notification types enum, `parentCommentId` field
- **GET /posts/:id/comments:** Returns nested comment structure — top-level comments with `replyCount` and `replies[]` array
- **POST /posts/:postId/comments/:commentId/like:** Like/unlike comments, creates `comment_like` notification
- **POST /posts/:id/comments (updated):** Accepts `parentCommentId` and `imageUrl`, creates `reply` notification for parent comment author
- **Comment images:** Single image upload via Cloudinary (`alu_comments` preset)

**Backend — Favorites System:**
- **Post Schema updated:** Added `savedBy: [String]` for private favorites (TikTok-style)
- **POST /posts/:id/favorite:** Toggle favorite (add/remove userId from savedBy array)
- **GET /posts/favorites:** Fetch all posts favorited by current user

**Backend — Notifications Grouping:**
- **GET /notifications (updated):** Returns Instagram-style grouped notifications — groups by (postId + type), returns aggregated user list with count
- Example: `{ type: 'like', postId: 'x', users: [{userId, displayName, avatarUrl}], count: 5 }`

**Frontend — Comment System:**
- **CommentsPanel.tsx (rewritten):** Instagram-style nested comments with image uploads
  - Reply button on top-level comments
  - Like button on all comments (shows count)
  - Image attachment (single image via file picker, replaces emoji)
  - "View/Hide X replies" toggle with indented reply threads
  - "Replying to [username]" indicator when replying
  - Image preview before posting
- **PostModal.tsx (updated):** Same nested comment functionality + image attachments

**Frontend — Notifications Tab:**
- **NEW: NotificationItem.tsx:** Grouped notification renderer with stacked avatars (max 3 visible, +N indicator)
- **NotificationsTab.tsx (rewritten):** Full Instagram-style grouped notifications UI
  - Fetches grouped notifications on mount
  - Auto-marks all as read when tab opens
  - Click notification → opens PostModal with related post
  - Stacked avatars for grouped actions
  - Text formatting: "User1, User2 and 3 others liked your post"
  - Empty state with icon

**Frontend — Favorites System:**
- **ProfileTab.tsx (updated):**
  - Fetches favorites from `GET /posts/favorites` when Favorites tab is active
  - Uses `sourcePostsForTab` to switch between user posts and favorited posts
  - Shows favorited posts in same grid layout
- **PostModal.tsx (updated):** BookmarkIcon wired to `POST /posts/:id/favorite` API, updates Dexie
- **HomeTab.tsx (updated):** BookmarkIcon wired to API, initializes savedPosts from post.savedBy data
- **db.ts:** Added `savedBy?: string[]` to Post interface

**Manual Upload Fixes:**
- **"Is this AI" toggle fixed:** Backend now reads `is_ai` from request instead of hardcoding to `false`
- **Video quality selector added:** UI shows 360p/720p/1080p/4K options (4K only for long videos, default 360p)
- **Backend quality processing:** Maps quality to Cloudinary height transformations (360/720/1080/2160)

**New Files:**
- `alu-frontend/src/app/components/NotificationItem.tsx` — Grouped notification component with stacked avatars
- `alu-frontend/src/app/components/EditCaptionModal.tsx` — Edit caption modal (from previous session)
- `alu-frontend/src/app/components/PostOptionsMenu.tsx` — 3-dot menu for profile posts (from previous session)

**Modified Files (Backend — 3 files):**
- `alu-backend/config/db.js` — Comment schema: parentCommentId, imageUrl | Notification schema: comment_like, reply types | Post schema: savedBy
- `alu-backend/routes/postRoutes.js` — Nested comments fetch, comment like endpoint, reply support, favorite endpoints
- `alu-backend/routes/notificationRoutes.js` — Grouped notifications aggregation by (postId + type)
- `alu-backend/routes/uploadRoutes.js` — Fixed is_ai reading, added quality parameter with Cloudinary transformations

**Modified Files (Frontend — 5 files):**
- `alu-frontend/src/app/components/CommentsPanel.tsx` — Complete rewrite with nested replies, images, likes
- `alu-frontend/src/app/components/PostModal.tsx` — Nested comments, image attachments, BookmarkIcon API
- `alu-frontend/src/app/components/tabs/NotificationsTab.tsx` — Complete rewrite with grouped notifications
- `alu-frontend/src/app/components/tabs/ProfileTab.tsx` — Favorites fetch and display logic
- `alu-frontend/src/app/components/tabs/HomeTab.tsx` — BookmarkIcon API, savedPosts initialization
- `alu-frontend/src/app/components/tabs/CreateTab.tsx` — Video quality selector UI, is_ai toggle
- `alu-frontend/src/app/db.ts` — Post interface: savedBy field

**Features Summary:**
✅ Nested comment replies (Instagram-style, max 1 level deep)
✅ Comment images (single image per comment)
✅ Comment likes with notifications (private, like TikTok)
✅ Instagram-style grouped notifications with stacked avatars
✅ TikTok-style private favorites system
✅ Profile Favorites tab
✅ "Is this AI" toggle working for manual uploads
✅ Video quality selector (360p to 4K)

**Build:** Frontend passes `npm run build` clean

### 2026-02-12: UI/UX Polish + Security Hardening — Session 12 (Claude Opus)

**Frontend UX Fixes:**
- **Feed width reduced:** HomeTab max-width changed from 950px to 750px (user feedback: too wide, reduce by 200px)
- **Comments behavior fixed:** Removed onClick from media div that was opening PostModal. Comments now properly open CommentsDrawer side panel instead of full modal.
- **Long Video option added:** CreateTab manual upload now has 3 types: Image, Short Video (under 1 min), Long Video (YouTube-style)
- **Delete from profile fixed:** ProfileTab PostOptionsMenu now properly deletes posts instead of opening PostModal. Added confirmation dialog with API call to `DELETE /posts/:id`.
- **PostModal removed from HomeTab:** Eliminated duplicate modal system, CommentsDrawer is now primary comments interface

**Backend Security Hardening:**
- **Rate limiting added:** Installed `express-rate-limit` package
  - Global limiter: 100 requests per 15 minutes per IP
  - Upload limiter: 10 requests per minute per IP
  - Generate limiter: 20 requests per hour per IP
- **MongoDB injection prevention:** Installed `express-mongo-sanitize` package
  - Replaces `$` and `.` with `_` in req.body/query/params
  - Logs suspicious sanitization attempts with IP address
- **Upload security:** Changed from `upload.any()` to `upload.array('files', 5)` with MIME type validation
  - Allowed types: image/jpeg, png, gif, webp | video/mp4, quicktime, webm, x-msvideo
  - Explicit file count limit (max 5 images for carousel)

**TypeScript Build Fixes:**
- **ShortsTab.tsx:** Added missing closing `</div>` tag at line 327
- **MediaItem.tsx:** Added null coalescing `localUrl || ''` for img/video src attributes (TypeScript type safety)
- **CreateTab.tsx:** Fixed ZapIcon className error by wrapping in span

**Deployment:**
- **Frontend repo fix:** Changed origin remote from Alubackend.git to Alufrontend.git (was pointing to wrong repo)
- **Vercel configuration:** Identified need to set Root Directory to `alu-frontend` in Vercel dashboard (nested folder structure)
- **Build passes:** All TypeScript errors resolved, successful Vercel deployment

**Modified Files (Backend — 2 files):**
- `alu-backend/server.js` — Added mongoSanitize middleware, 3 rate limiters (global, upload, generate)
- `alu-backend/routes/uploadRoutes.js` — Changed to `upload.array('files', 5)`, added MIME type fileFilter validation

**Modified Files (Frontend — 4 files):**
- `alu-frontend/src/app/components/tabs/HomeTab.tsx` — Reduced max-width to 750px, removed onClick from media, removed PostModal
- `alu-frontend/src/app/components/tabs/CreateTab.tsx` — Added Long Video option to manual upload types, fixed ZapIcon wrapper
- `alu-frontend/src/app/components/tabs/ProfileTab.tsx` — Fixed delete functionality with confirmation dialog and API call
- `alu-frontend/src/app/components/tabs/ShortsTab.tsx` — Added missing closing div tag
- `alu-frontend/src/app/components/MediaItem.tsx` — Added null coalescing for localUrl type safety

**Security Packages Added:**
- `express-rate-limit` — Prevent DDoS and abuse
- `express-mongo-sanitize` — Prevent MongoDB injection attacks

**Build:** Frontend passes `npm run build` clean, backend security middleware operational

### 2026-02-13: Security Audit + Local-First Architecture — Session 13 (Claude Sonnet)

**CRITICAL LEARNING — Local-First Architecture:**
- **User misunderstood moment:** I initially added 50MB file size restrictions thinking backend stores files → USER CORRECTED: "did u read the context.md u realize its local based??"
- **Architecture principle:** Users store media on THEIR device in OPFS (Origin Private File System). Backend is just a PASSTHROUGH/MIDDLEMAN for syncing to Cloudinary for sharing.
- **Why this matters:** Manual uploads are UNLIMITED because files never touch backend storage. Backend only handles metadata sync, AI API calls, and hosting.
- **Reverted restrictions:** Changed upload limit from 50MB back to 200MB (generous passthrough limit since user's device handles the actual size)
- **Key insight from context.md:** "Users store media on THEIR device (OPFS). Backend only handles: metadata sync, AI API calls, hosting. 10,000 users = minimal cloud storage costs"

**Git & Deployment Fixes:**
- **Frontend remote fix:** `git remote set-url origin https://github.com/Imma2013/Alufrontend.git` (was pointing to backend repo)
- **Vercel deployment:** User needs to set Root Directory to `alu-frontend` in dashboard (nested folder causes "No Next.js version detected" error)
- **Successful pushes:** Multiple commits (6383e97, 1131fa3, 7b65de6, a95aa15, b10492b) to correct frontend repo

**Backend Security Improvements (uploadRoutes.js):**
- **File size limit:** 200MB (was 100MB) — generous passthrough limit for local-first architecture
- **MIME type validation:** Strict allowlist for images (jpeg, png, gif, webp) and videos (mp4, quicktime, webm, x-msvideo)
- **Secure upload method:** `upload.array('files', 5)` instead of `upload.any()` (prevents arbitrary field names)
- **Error message improvement:** Shows specific MIME type when file is rejected

**Web Research on Local-First:**
- Researched OPFS (Origin Private File System) for local file storage
- Studied offline-first sync patterns with cloud as distribution layer
- Confirmed Dexie.js (IndexedDB) for metadata, OPFS for large file storage
- Verified local-first reduces cloud storage costs (users store their own data)

**Pending Security Tasks (not yet implemented):**
- Task 21: Backend - Add input validation + XSS protection (sanitize HTML in captions/comments, validate lengths, validate MongoDB ObjectIds)
- Task 22: Backend - Implement cursor-based pagination for /feed, /posts/:id/comments, /posts/favorites
- Task 23: Frontend - Add error handling + toasts (install react-hot-toast, implement error toasts, add rollback for optimistic updates)
- Task 24: Frontend - Add loading states + infinite scroll (loading spinners for actions, intersection observer for feed pagination)
- Task 25: Frontend - Fix misc bugs (add search debouncing 300ms, remove localhost fallback, fix blob URL memory leaks)

**Modified Files:**
- `alu-backend/routes/uploadRoutes.js` — Updated fileSize limit to 200MB, kept MIME type validation
- `alu-backend/server.js` — Rate limiting and MongoDB sanitization from Session 12

**Key Takeaway:**
This session reinforced the importance of reading context.md thoroughly and understanding the LOCAL-FIRST architecture. Backend is NOT a file storage system — it's a metadata sync layer + AI orchestrator + passthrough to Cloudinary. Users own their data, stored locally on their device.

**Build:** All TypeScript errors resolved, frontend deployed successfully to Vercel

---

### NEXT SESSION PRIORITIES:
1. **Complete security tasks:** Input validation, XSS protection, pagination, error handling (Tasks 21-25)
2. **Real-time messaging**: Chat interface with WebSocket/SSE, text + image in chats
3. **Stories**: Upload photo stories (from camera roll), plus button on profile pic, swipe through
4. **PWA manifest + service worker**: Install to mobile home screen
5. **@ mention system**: Tag users in comments/captions
6. **Image cropping on upload** (Instagram-style)
7. **Notification badges**: Show unread count on NotificationsIcon in nav
