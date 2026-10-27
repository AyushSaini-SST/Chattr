# Chattr — Product Requirements Document

Version 1.0 · October 2026

## 1. Purpose

This document defines what Chattr must do, for whom, and how success is judged. It is the reference for scope decisions during development and the baseline against which future releases are planned. The technical design that satisfies these requirements is described separately in `Technical.md`.

## 2. Goals

Give a community one place to share ideas publicly and talk privately, with a feed that is chronological and scoped to the people a member chooses to follow. Keep the product calm: no ranking, no engagement mechanics, clear controls over who can see and contact you. Ship as a production web app that runs on free or low-cost hosting with no operational burden beyond rotating a secret and watching a dashboard.

## 3. Non-goals

Group conversations, end-to-end encryption, a moderator dashboard, video, stories, algorithmic recommendations, advertising and public (logged-out) browsing are out of scope for version 1.0. Each would change the product's character or its operating cost and is listed under Future considerations instead.

## 4. Users and personas

The student: part of a college batch of a few hundred people, checks the app a few times a day between classes, mostly reads, occasionally posts, and uses messages to coordinate with two or three people. Wants to find classmates and not be contacted by strangers.

The organiser: runs a reading group or a club, posts announcements, wants replies in comments and quiet follow-ups in messages, and pins the current announcement to their profile.

The private member: shares only with followers, approves each follow request, keeps message requests restricted, and expects blocking to be immediate and complete.

## 5. Functional requirements

### 5.1 Accounts and sessions

A person can register with a unique username (3 to 24 characters, letters, numbers and underscores), a unique email, a display name and a password of at least 10 characters. Login accepts either username or email. Sessions are kept in an HttpOnly cookie and survive page reloads; logout clears the session on the server and the client. The API never returns password hashes or another member's email.

### 5.2 Profiles

Members edit display name, bio (up to 280 characters), headline (100), profile link (a valid URL), avatar (cropped client-side, uploaded when media is configured), privacy flag and messaging preference. Profiles show follower and following counts; both lists open in a dialog with follow controls. A member can pin exactly one of their own posts; it appears first on their profile with a pinned marker. Private profiles reveal only name and username to non-followers, and their posts return a 403 to non-followers.

### 5.3 Following

Following a public account is immediate. Following a private account creates a request the owner accepts or declines from their profile; a pending request can be cancelled. Unfollowing is immediate. Suggestions exclude accounts already followed, requested or blocked.

### 5.4 Posts

A post has text (up to 2000 characters) and optionally one image (JPG, PNG, WebP or GIF up to 8 MB) with optional alt text up to 200 characters. Visibility is public or followers-only. Hashtags (`#word`, letters, numbers and underscores, up to 40 characters, up to 20 per post) are extracted on save and rendered as links to a tag feed. Authors can edit text and delete the post; deleting removes its comments, saves and media.

Readers can like, react with one of four kinds (heart, spark, laugh, sad; one active reaction per person, changeable), comment (up to 1000 characters) and save privately. Comment authors and post authors can delete comments. Like and reaction counts are shown; the list of who reacted is not exposed.

### 5.5 Feeds and discovery

Home shows posts by followed accounts and the member's own posts, newest first, then continues into public posts from accounts not followed, with cursor pagination. Explore lists public posts and member profiles with post previews. Tag pages list visible posts carrying a tag. Search matches people by username and display name and posts by text; a query beginning with `#` searches tags only. Every feed applies the same visibility rule: own posts always, blocked relationships never, followers-only and private-account posts only to accepted followers.

### 5.6 Messaging

Conversations are one-to-one and persistent. A conversation starts as accepted when both people follow each other or the recipient accepts messages from everyone, otherwise as a request with the first message attached; the recipient accepts or declines. Members set a preference of everyone, followers or nobody. Messages are up to 4000 characters. The inbox shows conversations ordered by latest message with unread counts and presence; opening a conversation marks it read and shows read receipts to the sender. Typing indicators are shown live.

Either participant can mute a conversation, which suppresses message notifications from it until unmuted and is marked in the inbox. A message can be reacted to with the same four reactions as posts. A sender can delete a message for everyone; either side can remove a message for themselves. Blocking closes access to the conversation for both sides immediately.

### 5.7 Notifications

Members receive notifications for new followers, likes, reactions, comments, messages and message requests. The timeline shows unread state, individual and bulk mark-as-read, and links to the related post, profile or conversation. The sidebar shows the unread count live. Quiet hours let a member define a daily window (which may cross midnight) during which notifications are still stored but not pushed live.

### 5.8 Safety

Members can block and unblock accounts; blocked accounts cannot see each other's profiles, posts, or message each other, and existing conversations become unavailable. Members can report accounts and posts with a reason. Settings list blocked accounts with unblock controls.

### 5.9 Data ownership

Settings offer a one-click JSON export containing the account's profile, posts with comments, saved posts, follows, followers, blocked accounts and conversations with messages the member has not deleted. The export includes only public identity (username, display name) for other people.

### 5.10 Drafts, theme and layout

An unsent home composer draft is kept on the device per account for seven days and restored on return, with a discard option. Light and dark themes are available and remembered per device. The interface works from 320 px wide upward with a bottom navigation bar on small screens.

## 6. Non-functional requirements

Security: passwords hashed with bcrypt; sessions in secure, HttpOnly, SameSite=None cookies in production; state-changing requests require an allowed Origin; all inputs validated; standard security headers; rate limiting on the API; uploaded files type-sniffed; media served through visibility checks.

Performance: feed and conversation pages load within one request each with cursor pagination capped at 30 items; realtime updates arrive within a second on a healthy connection; the production JavaScript bundle stays under 200 KB gzipped.

Reliability: the API exposes a health endpoint used by the host; the server refuses to start without required configuration; database indexes cover every list and lookup in the product.

Accessibility: all controls are keyboard reachable, icon-only buttons are labelled, images carry alt text, live regions announce loading and errors, and colour contrast meets WCAG AA in both themes.

Operability: a single blueprint deploys the API; the web app deploys from the repository with one environment variable; CI runs the test suites and a production build on every change.

## 7. Success measures

For a pilot community the targets are: at least half of registered members post or message within their first week; message requests are answered within a day in the median; fewer than one report per hundred members per month; no security incidents; API p95 latency under 400 ms on the free tier at pilot scale.

## 8. Release scope for 1.0

Everything in section 5 ships in 1.0, with the Sketchbook theme as the only visual theme (light and dark), English copy only, and media uploads enabled wherever Cloudinary credentials are configured.

## 9. Future considerations

Candidate additions, in rough priority order: group conversations; a moderator queue for reports; email verification and password reset; link previews in posts; keyword muting; scheduled posts; a progressive web app manifest with push notifications outside quiet hours; localisation. Each will get its own requirements addendum before work starts.
