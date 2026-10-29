Chattr
Chattr is a calm, community-first social app: a shared feed for ideas and private one-to-one messages, drawn in a hand-sketched notebook style. It is built for students, small professional communities and groups who want a quieter alternative to large social networks.
The API runs on Render and the web app on Vercel. Everything needed to run it locally or ship it is in this repository.
Problem Statement
Large social platforms are overwhelming — too noisy, too addictive, no real community feel. Students and small groups need a quieter space to share ideas and talk privately without the chaos of Twitter or Instagram.
Target Users
Students, small professional communities, and close-knit groups who want a distraction-free space to connect.
Demo Video
https://drive.google.com/file/d/1_Gq3x7Yh1J9Si3mVFb72mqx6dE2tJoBa/view?usp=drive_link
What it does
People register with a username and email, keep an editable profile with an avatar, and choose whether their account is private. Posts can be text, an image with alt text, or both, and are visible either to everyone or to followers only. Hashtags inside a post become links to a tag feed. Readers can like, react with one of four reactions, comment, and save posts; authors can edit, delete and pin one post to the top of their profile.
Messaging is one-to-one and persistent. Conversations open directly between people who follow each other or when the recipient accepts messages from everyone; otherwise the first message becomes a request. Chats show presence, typing and read state live over Socket.IO, support reactions on individual messages, per-conversation muting, and deleting a message for yourself or for everyone.
Notifications cover follows, likes, reactions, comments, messages and message requests. Quiet hours keep the live ping silent during a chosen window while still storing every notification. Accounts can block and report other accounts or posts, and download a complete JSON export of their own data from Settings.
The composer keeps an unsent draft on the device, the theme (light or dark) is remembered per device, and the whole interface is responsive down to phone widths.
Key Features
• Social feed — text and image posts, hashtags, likes, reactions, comments, save, pin
• Real-time messaging — Socket.IO powered DMs with typing indicators, read receipts, presence
• Message requests — controlled inbox; first message from a stranger becomes a request
• Notifications — follows, likes, reactions, comments, DMs; quiet hours support
• Privacy controls — private accounts, block, report, followers-only posts
• Data export — download your full account data as JSON from Settings
• Dark / light theme — remembered per device
• Responsive — works down to phone widths
Stack
Layer
Technology
Web app
React 19, Vite 7, React Router 7, Axios, Socket.IO client
API
Node.js 22, Express 5, Mongoose 8, Socket.IO, Zod, Helmet, express-rate-limit
Data
MongoDB Atlas
Media
Cloudinary (optional; image uploads are enabled when credentials are present)
Auth
bcrypt password hashing, JWT in an HttpOnly cookie
Hosting
Render (API, via render.yaml) and Vercel (web, via frontend/vercel.json)
Architecture
User (Browser)
    │
    ├── REST API (Axios) ──────────────────► Express Routes
    │                                              │
    └── WebSocket (Socket.IO) ──────────────► Realtime Server
                                                   │
                               ┌───────────────────┼───────────────────┐
                           Middleware           Services            Models
                         (auth, rate          (messaging,        (Mongoose
                          limit, Zod)          notifs)           schemas)
                                                   │
                                            MongoDB Atlas
Repository layout
chattr/
├─ backend/            Express API and Socket.IO server
│  ├─ src/config/      environment validation, database connection
│  ├─ src/middleware/  auth, origin checks, uploads, errors
│  ├─ src/models/      Mongoose schemas
│  ├─ src/routes/      REST endpoints grouped by resource
│  ├─ src/services/    messaging rules, notifications, quiet hours, media
│  ├─ src/realtime/    Socket.IO server
│  └─ test/            node:test suites
├─ frontend/           Vite + React single-page app
│  ├─ src/pages/       Home, Explore, Messages, Notifications, Auth
│  ├─ src/features/    pure logic modules (reactions, drafts, hashtags, follow sync)
│  ├─ src/styles.css   structural styles
│  ├─ src/sketchbook.css  the Sketchbook visual theme (light and dark)
│  └─ test/            node:test suites
├─ docs/               product overview, PRD and technical reference
├─ render.yaml         Render blueprint for the API
└─ .github/workflows   CI: tests and build on every push
Local development
Requirements: Node.js 20.19 or newer (22 recommended), npm 10, and a MongoDB connection string. A free MongoDB Atlas cluster is enough.
Install dependencies from the repository root:
npm install
Create backend/.env from backend/.env.example and fill in MONGODB_URI and a JWT_SECRET of at least 32 characters. A secret can be generated with:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
Image uploads need the three Cloudinary variables; without them the app runs normally with text-only posts and initials as avatars. The frontend reads VITE_API_URL from frontend/.env and defaults to http://localhost:5000.
Start both servers:
npm run dev
The web app is served at http://localhost:5173 and the API at http://localhost:5000, with a health check at http://localhost:5000/api/health. npm run dev:backend and npm run dev:frontend start them separately.
Tests
npm test
This runs the backend suites (route behaviour, access rules, validation, reactions, quiet hours) and the frontend suites (pure feature modules) with Node's built-in test runner. No database is required; data access is stubbed. CI runs the same commands plus a production build on every push and pull request.
Environment Variables
Variable
Where
Purpose
NODE_ENV
API
development, test or production. Production enables secure, cross-site cookies and proxy trust.
PORT
API
Port to listen on. Render sets this automatically.
MONGODB_URI
API
MongoDB connection string. Required.
JWT_SECRET
API
Session signing secret, at least 32 characters. Required.
CLIENT_URL
API
Origin of the deployed web app, for CORS, cookies and Socket.IO.
CLIENT_URL_ALLOWLIST
API
Optional comma-separated extra origins, for Vercel preview deployments or staging.
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
API
Optional. Enables avatar and post image uploads.
VITE_API_URL
Web
Base URL of the API, without a trailing slash.
Never commit .env to version control. Use .env.example as the template.
Deployment
API on Render
Create a new Blueprint in the Render dashboard and point it at this repository. Render reads render.yaml, builds the backend directory and starts node src/server.js with the health check on /api/health. The blueprint generates JWT_SECRET; MONGODB_URI, CLIENT_URL and the optional Cloudinary values are entered in the dashboard when the service is created.
Web app on Vercel
Import the repository in Vercel and set the Root Directory to frontend. Add one environment variable, VITE_API_URL, set to the Render service URL such as https://chattr-api.onrender.com.
Security notes
Passwords are hashed with bcrypt and never returned by the API. Sessions are JWTs stored in an HttpOnly cookie; the API only accepts state-changing requests whose Origin header matches an allowed client, which blocks cross-site request forgery. All inputs are validated with Zod, Helmet sets standard security headers, and the /api namespace is rate limited. Uploaded images are type-sniffed before they reach Cloudinary and are served through the API so that visibility rules for followers-only posts also apply to media. Data exports include only the requesting account's own data and other people's public identity.
Documentation
docs/product.md describes the product and its audience, docs/PRD.md is the product requirements document, and docs/Technical.md is the technical reference covering architecture, data model, API, realtime events and operational details.
License
Private project. All rights reserved.
