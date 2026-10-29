# Chattr

Chattr is a calm, community-first social app: a shared feed for ideas and private one-to-one messages, drawn in a hand-sketched notebook style. Built for students, small professional communities and groups who want a quieter alternative to large social networks.

## Problem Statement

Large social platforms are overwhelming — too noisy, too addictive, no real community feel. Students and small groups need a quieter space to share ideas and talk privately without the chaos of Twitter or Instagram.

## Target Users

Students, small professional communities, and close-knit groups who want a distraction-free space to connect.

## Demo Video

https://drive.google.com/file/d/1_Gq3x7Yh1J9Si3mVFb72mqx6dE2tJoBa/view?usp=drive_link

## What it does

People register with a username and email, keep an editable profile with an avatar, and choose whether their account is private. Posts can be text, an image with alt text, or both, and are visible either to everyone or to followers only. Hashtags inside a post become links to a tag feed. Readers can like, react with one of four reactions, comment, and save posts; authors can edit, delete and pin one post to the top of their profile.

Messaging is one-to-one and persistent. Conversations open directly between people who follow each other or when the recipient accepts messages from everyone; otherwise the first message becomes a request. Chats show presence, typing and read state live over Socket.IO, support reactions on individual messages, per-conversation muting, and deleting a message for yourself or for everyone.

Notifications cover follows, likes, reactions, comments, messages and message requests. Quiet hours keep the live ping silent during a chosen window while still storing every notification. Accounts can block and report other accounts or posts, and download a complete JSON export of their own data from Settings.

The composer keeps an unsent draft on the device, the theme (light or dark) is remembered per device, and the whole interface is responsive down to phone widths.

## Key Features

- **Social feed** — text and image posts, hashtags, likes, reactions, comments, save, pin
- **Real-time messaging** — Socket.IO powered DMs with typing indicators, read receipts, presence
- **Message requests** — controlled inbox; first message from a stranger becomes a request
- **Notifications** — follows, likes, reactions, comments, DMs; quiet hours support
- **Privacy controls** — private accounts, block, report, followers-only posts
- **Data export** — download your full account data as JSON from Settings
- **Dark / light theme** — remembered per device
- **Responsive** — works down to phone widths

## Stack

| Layer | Technology |
| --- | --- |
| Web app | React 19, Vite 7, React Router 7, Axios, Socket.IO client |
| API | Node.js 22, Express 5, Mongoose 8, Socket.IO, Zod, Helmet, express-rate-limit |
| Data | MongoDB Atlas |
| Media | Cloudinary (optional; image uploads are enabled when credentials are present) |
| Auth | bcrypt password hashing, JWT in an HttpOnly cookie |
| Hosting | Render (API) and Vercel (web) |

## Architecture

User (Browser)
│
├── REST API (Axios) ──────────────────► Express Routes
│ │
└── WebSocket (Socket.IO) ──────────────► Realtime Server
│
┌───────────────────┼───────────────────┐
Middleware Services Models
(auth, rate (messaging, (Mongoose
limit, Zod) notifs) schemas)
│
MongoDB Atlas


## Repository layout

chattr/
├─ backend/ Express API and Socket.IO server
│ ├─ src/config/ environment validation, database connection
│ ├─ src/middleware/ auth, origin checks, uploads, errors
│ ├─ src/models/ Mongoose schemas
│ ├─ src/routes/ REST endpoints grouped by resource
│ ├─ src/services/ messaging rules, notifications, quiet hours, media
│ ├─ src/realtime/ Socket.IO server
│ └─ test/ node:test suites
├─ frontend/ Vite + React single-page app
│ ├─ src/pages/ Home, Explore, Messages, Notifications, Auth
│ ├─ src/features/ pure logic modules (reactions, drafts, hashtags, follow sync)
│ ├─ src/styles.css structural styles
│ ├─ src/sketchbook.css the Sketchbook visual theme (light and dark)
│ └─ test/ node:test suites
├─ docs/ product overview, PRD and technical reference
├─ render.yaml Render blueprint for the API
└─ .github/workflows CI: tests and build on every push


## Local development

Requirements: Node.js 20.19 or newer (22 recommended), npm 10, and a MongoDB connection string.

Install dependencies:

```sh
npm install
```

Create `backend/.env` from `backend/.env.example` and fill in `MONGODB_URI` and `JWT_SECRET` (min 32 chars):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start both servers:

```sh
npm run dev
```

Web app at `http://localhost:5173`, API at `http://localhost:5000`.

## Tests

```sh
npm test
```

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NODE_ENV` | API | `development`, `test` or `production` |
| `PORT` | API | Port to listen on |
| `MONGODB_URI` | API | MongoDB connection string. Required |
| `JWT_SECRET` | API | Session signing secret, min 32 chars. Required |
| `CLIENT_URL` | API | Origin of the deployed web app |
| `CLIENT_URL_ALLOWLIST` | API | Optional extra origins |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | API | Optional. Enables image uploads |
| `VITE_API_URL` | Web | Base URL of the API |

> Never commit `.env` to version control. Use `.env.example` as the template.

## Deployment

### API on Render

Create a Blueprint in Render dashboard, point it at this repo. Render reads `render.yaml` and provisions everything. Add `MONGODB_URI`, `CLIENT_URL`, and optional Cloudinary vars in the dashboard.

### Web app on Vercel

Import repo in Vercel, set Root Directory to `frontend`. Add `VITE_API_URL` pointing to your Render API URL.

## Security

Passwords hashed with bcrypt, never returned by API. JWTs stored in HttpOnly cookies. CSRF blocked via Origin header checks. All inputs validated with Zod. Helmet sets security headers. Rate limiting on `/api`. Images type-sniffed before Cloudinary upload.

## License

Private project. All rights reserved.
