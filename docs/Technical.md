# Chattr — Technical Reference

Version 1.0 · October 2026

## 1. Architecture

Chattr is a split deployment. A React single-page app, built with Vite and hosted on Vercel, talks to an Express API hosted on Render. The API owns all state in MongoDB Atlas, serves media stored on Cloudinary, and pushes realtime events to the browser over Socket.IO on the same HTTP server.

```
Browser (React + Socket.IO client)
   │  HTTPS, cookie session, JSON
   ▼
Render web service: Express 5 + Socket.IO (backend/src)
   │                      │
   ▼                      ▼
MongoDB Atlas          Cloudinary (optional)
```

Both halves are plain Node.js 22 projects managed as npm workspaces from the repository root. There is no server-side rendering, no build step on the API, and no shared runtime code between the two packages; the contract between them is the HTTP API and the socket events described below.

## 2. Backend

### 2.1 Layout

`src/server.js` validates configuration, connects to MongoDB, creates the HTTP server, attaches Socket.IO and listens. `src/app.js` builds the Express app: Helmet, CORS limited to the allowed client origins, JSON body parsing (1 MB), cookie parsing, a rate limiter of 300 requests per 15 minutes per client on `/api`, the route modules, then 404 and error handlers. In production `trust proxy` is enabled so secure cookies and client IPs work behind Render's load balancer.

`src/config/env.js` parses `process.env` with Zod and exports `env`, `allowedOrigins` (the primary `CLIENT_URL` plus any `CLIENT_URL_ALLOWLIST` entries) and `isAllowedOrigin`. `validateRuntimeEnv` refuses to start without `MONGODB_URI` and a 32-character `JWT_SECRET`.

Middleware: `requireAuth` reads the `chattr_session` cookie, verifies the JWT and loads the user; `requireClientOrigin` rejects state-changing requests whose `Origin` is not an allowed client; `imageUpload` wraps multer with size, count and MIME limits and sniffs magic bytes; `errorHandler` and `notFound` produce `{ error: { message } }` responses.

Services hold rules shared by routes: `messaging.js` (block, mutual-follow and preference checks), `followRequests.js`, `messageDeletion.js`, `notifications.js` (persist, then push unless the recipient is in quiet hours), `quietHours.js`, `postPresentation.js` (reaction summaries and media URL rewriting), `cloudinary.js`.

`src/realtime/socketServer.js` authenticates sockets with the same cookie, joins each socket to `user:<id>`, tracks presence, lets clients join `conversation:<id>` rooms after an access check, and relays typing events. `emitToUser`, `emitToConversation` and `revokeConversationAccess` are the only ways routes talk to sockets.

### 2.2 Data model

All collections use Mongoose with timestamps. Identifiers are ObjectIds.

User: `username` (unique, lowercase), `email` (unique, never serialised), `passwordHash` (select false), `displayName`, `bio`, `headline`, `profileLink`, avatar fields (`avatarUrl` is an API path with a revision query; Cloudinary identifiers are select false), `isPrivate`, `messagePreference` (`everyone` | `followers` | `nobody`), `pinnedPost` (Post ref or null), `quietHours` (`enabled`, `start` and `end` as `HH:MM`, `timezoneOffset` in minutes).

Post: `author`, `text` (≤ 2000, required unless an image is present), `image` (Cloudinary URL and public id select false; `width`, `height`, `format`, `bytes`, `alt`), `visibility` (`public` | `followers`), `likes` (user ids), `reactions` (`{ user, kind }` with kind in `heart`, `spark`, `laugh`, `sad`), `tags` (lower-cased, extracted from text on validate, indexed), embedded `comments` (`author`, `text` ≤ 1000). Indexes on `createdAt`/`_id` and `author`/`createdAt`/`_id` support cursor pagination.

Follow and FollowRequest: unique `(follower, following)` pairs. Block: unique `(blocker, blocked)`. SavedPost: unique `(user, post)`.

Conversation: canonical sorted pair `participantA`/`participantB` (unique), `status` (`accepted` | `pending` | `rejected`), `acceptedVia` (`mutual` | `preference` | `request`), `requestedBy`, `requestTo`, `lastMessage`, `lastMessageAt`, `mutedBy` (user ids).

Message: `conversation`, `sender`, `text` (≤ 4000), `readBy`, `deletedFor`, `deletedForEveryone`, `reactions` (same shape as posts). Indexed by conversation and time.

Notification: `recipient`, `actor`, `type` (`follow`, `like`, `reaction`, `comment`, `message`, `message_request`), `entityId`, `text` (≤ 120), `readAt`. Report: hidden `reporter`, optional `targetUser`/`targetPost`, `reason`, `details`, `status`.

### 2.3 Visibility rule

`canView(post, viewerId)` in `postRoutes.js` is the single rule used by feeds, search, tag pages, saved posts, media and all post mutations: the author always sees their post; a block in either direction hides it; followers-only posts and posts by private accounts require an accepted follow; everything else is visible. Feeds over-fetch (four times the page size) and filter with this rule so that pagination cursors stay stable.

### 2.4 Reactions

A post or message holds at most one reaction per user. `PUT …/react` with `{ kind }` creates or changes it, `DELETE …/react` removes it. Responses and all post payloads carry `reactions: { counts: { heart, spark, laugh, sad }, total, myReaction }`; the raw per-user list never leaves the server. The first reaction by a user on a post creates a `reaction` notification; changing the kind does not. Message reactions broadcast `message:changed` with `action: 'reacted'` to both participants.

### 2.5 Hashtags

`extractTags` (in `models/Post.js`) runs in a pre-validate hook and stores up to 20 lower-cased tags per post. `GET /api/posts/tag/:tag` pages through visible posts carrying the tag with the standard cursor; `GET /api/search?q=#tag` returns only posts for that tag.

### 2.6 Quiet hours and muting

`createNotification` always writes the notification, then loads the recipient's `quietHours` and skips the `notification:new` socket emit when `isWithinQuietHours` is true. The window is evaluated in the user's local time using the stored offset and supports ranges that cross midnight. Muting is checked in the message routes before a `message` notification is created; the message itself is still delivered over the conversation room.

### 2.7 Pinned post and export

`PATCH /api/users/me` accepts `pinnedPostId` (own post id or `null`); `GET /api/users/:username/posts` prepends the pinned post with `isPinned: true` when it is visible to the viewer. `GET /api/users/me/export` assembles the account's own data in one JSON document with a `Content-Disposition` attachment header and `Cache-Control: no-store`.

### 2.8 Media

Uploads go to Cloudinary under `chattr/avatars/<userId>` and `chattr/posts/<userId>`. Clients never receive Cloudinary URLs; they request `/api/media/avatars/:userId/image` or `/api/media/posts/:postId/image`, which check block and visibility rules and then proxy the asset with `Cache-Control: private, no-store`. When Cloudinary is not configured, upload endpoints return 503 and the rest of the app works unchanged.

## 3. HTTP API

All routes are under `/api` and, except registration, login and health, require the session cookie. Errors are `{ error: { message } }` with an appropriate status. Mutations additionally require an allowed `Origin`.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness check used by Render. |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session lifecycle. |
| `GET /users/search?q=`, `GET /users/suggestions`, `GET /users/discover` | People discovery. |
| `GET /users/:username`, `GET /users/:username/posts`, `GET /users/:username/followers`, `GET /users/:username/following` | Profiles. |
| `PATCH /users/me`, `POST /users/me/avatar`, `GET /users/me/export` | Own account: profile fields, privacy, messaging preference, `pinnedPostId`, `quietHours`, avatar, data export. |
| `POST`/`DELETE /users/:username/follow`, `GET /users/follow-requests`, `PATCH /users/follow-requests/:requestId` | Following and private-account requests. |
| `POST`/`DELETE /users/:username/block`, `GET /users/blocked` | Blocking. |
| `GET /posts?feed=following\|explore&cursor=`, `POST /posts`, `GET /posts/:postId`, `PATCH /posts/:postId`, `DELETE /posts/:postId` | Feeds and post lifecycle. `POST` accepts JSON or multipart with `image` and `imageAlt`. |
| `GET /posts/tag/:tag?cursor=` | Tag feed. |
| `PUT`/`DELETE /posts/:postId/like`, `PUT`/`DELETE /posts/:postId/react`, `POST /posts/:postId/comments`, `DELETE /posts/:postId/comments/:commentId`, `POST`/`DELETE /posts/:postId/save` | Post interactions. |
| `GET /saved` | Saved posts. |
| `GET /search?q=` | People and posts; `#tag` queries search tags. |
| `GET /messages`, `GET /messages/requests`, `PATCH /messages/requests/:conversationId` | Inbox and requests. |
| `POST /messages/:username` | Start or continue a conversation with a person. |
| `GET`/`POST /messages/:conversationId/messages`, `POST /messages/:conversationId/read` | Conversation history, sending, read state. |
| `POST`/`DELETE /messages/:conversationId/mute` | Mute and unmute. |
| `PUT`/`DELETE /messages/message/:messageId/react` | Message reactions. |
| `DELETE /messages/message/:messageId`, `DELETE /messages/message/:messageId/everyone` | Delete for me, delete for everyone. |
| `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:notificationId/read` | Notifications. |
| `POST /reports/user/:username`, `POST /reports/post/:postId` | Reporting. |
| `GET /media/avatars/:userId/image`, `GET /media/posts/:postId/image` | Access-checked media. |

## 4. Realtime events

Server to client: `notification:new` (populated notification), `notifications:count` (`{ unreadCount }`), `message:new` (formatted message, to the conversation room), `message:changed` (`{ messageId, conversationId, action }` with action `deleted-for-me`, `deleted-for-everyone` or `reacted`), `read:update`, `typing:update`, `conversation:update`, `conversation:unavailable`, `message-request:new`, `message-request:updated`, `presence:update`, `account:blocks:update`.

Client to server: `conversation:join` (with acknowledgement), `typing:start`, `typing:stop`.

Sockets authenticate from the session cookie during the handshake; CORS for the socket server uses the same allowed origins as HTTP.

## 5. Frontend

### 5.1 Structure

`src/main.jsx` mounts the router and `AuthProvider` and imports `styles.css` (structure, layout, responsive rules) followed by `sketchbook.css` (the visual theme). `App.jsx` holds the shell (sidebar converted to notebook tabs by the theme, top bar with search and theme toggle, mobile bottom navigation), route switching by pathname, the profile and settings pages, and small shared components. Pages live in `src/pages`: `SocialPage` (composer, post cards, feeds for home, explore, saved, profile and tag), `MessagesPage`, `NotificationsPage`, `ExplorePage`, `AuthPage`.

`src/features` contains framework-free modules that are unit tested with `node:test`: `posts/reactions.js` (optimistic reaction updates and request shapes), `posts/hashtags.js` (segmenting text for safe rendering), `posts/composerDraft.js` (per-account draft persistence with expiry), `posts/postLike.js`, `posts/postFollowAction.js`, `posts/postAuthorNavigation.js`, `users/followSync.js` (cross-component follow state), `auth/userState.js`.

`src/services/api.js` is a single Axios instance with `withCredentials` and the API base URL from `VITE_API_URL`; `mediaUrl` resolves media paths against it.

### 5.2 State and realtime

Authentication state lives in `AuthContext`; `updateCurrentUser` merges server responses (for example after pinning a post or saving quiet hours). Feeds keep local arrays and apply optimistic updates for likes and reactions, replacing them with the server's summary on success and rolling back on failure. The sidebar, the right rail and the messages page each open their own socket and subscribe only to the events they render; sockets disconnect on unmount.

### 5.3 Theme

`sketchbook.css` redefines the design tokens that `styles.css` consumes (`--color-*`, `--nav-*`, radii) for both `:root` and `:root[data-theme='dark']`, then restyles the shell: the sidebar becomes a horizontal row of coloured notebook tabs, the main content becomes a bordered page with spiral rings, surfaces get ink outlines with slightly irregular corner radii and offset shadows, and controls use the handwriting display face. The theme is additive, so structural fixes continue to be made in `styles.css`. Reduced-motion users get no rotations or transitions.

### 5.4 Build

`vite build` produces `dist/` with hashed assets. The bundle is roughly 150 KB gzipped of JavaScript and 30 KB of CSS. Fonts load from Google Fonts with preconnect hints in `index.html`.

## 6. Security

Passwords: bcrypt with per-password salt. Sessions: JWT signed with `JWT_SECRET`, stored in an HttpOnly cookie that is `Secure` and `SameSite=None` in production (cross-site between Vercel and Render) and `Lax` in development. CSRF: mutations require an `Origin` in the allowed list; the cookie alone is not enough. Input: every body is parsed with strict Zod schemas, ids are validated as ObjectIds before queries, and search terms are escaped before becoming regular expressions. Headers: Helmet defaults. Abuse: rate limiting on `/api`, upload size caps (5 MB avatars, 8 MB post images), magic-byte sniffing. Privacy: emails, password hashes, Cloudinary identifiers and reporter identities are excluded from serialisation at the schema level; reaction lists are summarised; exports contain only the requester's data.

## 7. Configuration and deployment

Environment variables are documented in the README. The API deploys from `render.yaml` (Node 22, `backend` as root, health check on `/api/health`, `JWT_SECRET` generated by Render). The web app deploys from Vercel with `frontend` as the root directory; `frontend/vercel.json` provides the SPA rewrite, immutable caching for `/assets` and security headers. CI (`.github/workflows/ci.yml`) installs with `npm ci`, runs both test suites and builds the web app.

Cross-site cookies require HTTPS on both ends and an exact `CLIENT_URL` match. For preview deployments add their origins to `CLIENT_URL_ALLOWLIST`, or point previews at a staging API.

## 8. Testing

Both packages use Node's built-in test runner (`node --test`). Backend tests stub Mongoose model methods and exercise the Express app directly, covering feed assembly, access rules, follow requests, blocking and inbox behaviour, message deletion, uploads, media access, validation, hashtag extraction, reaction summaries and quiet-hour evaluation. Frontend tests cover the pure feature modules. `npm test` at the root runs everything; no database or network is needed.

## 9. Operations

Health: `GET /api/health` returns `{ status: 'ok', service: 'chattr-api' }`. Logs: the API prints startup and fatal errors to stdout and stderr, which Render captures. Scaling: the API is stateless apart from in-memory presence counts, so a single instance is assumed; moving to multiple instances would need the Socket.IO Redis adapter and a shared presence store. Backups: use Atlas scheduled snapshots. Secrets: rotate `JWT_SECRET` to invalidate all sessions; rotate Cloudinary keys from the Cloudinary console and update Render.
