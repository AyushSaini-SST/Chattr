# Chattr — Product Overview

## One line

Chattr is a small, calm social space where a community shares short posts and continues the good ones in private, one-to-one conversation.

## The problem

Student groups, small professional communities and clubs usually end up split across two kinds of tools. Public feeds (large social networks) are optimised for reach and engagement, so a thoughtful post disappears under algorithmic noise and the follow-up conversation happens somewhere else. Group chats are immediate but ephemeral: anything worth keeping scrolls away within a day, and a private conversation with one person means yet another app.

Chattr brings the two halves together on purpose: a chronological feed scoped to the people you follow, and a direct messaging layer that sits one tap away from every post. Nothing is ranked, nothing is promoted, and the interface is designed to feel like a notebook rather than a dashboard.

## Who it is for

The primary audience is a cohort or community of between roughly twenty and a few thousand people who already know each other loosely: a college batch, an alumni group, a meetup, a small company. They want to see what peers are thinking, find people to talk to, and keep conversations private when they need to be. Secondary audiences are small interest groups (reading clubs, running groups) and early-stage teams who want a lightweight internal social layer without adopting a large platform.

## What makes it different

The feed is chronological and follows-first. It shows posts from people you follow and, once those run out, public posts from the wider community, with a clear boundary between the two. Every post can be limited to followers, and private accounts gate both their posts and their follower list behind approved follow requests.

Reactions are deliberately few. Alongside a plain like there are four reactions (love, inspiring, laugh, that is hard) that work the same way on posts and on individual messages. The set is small enough to be expressive without turning into a scoreboard.

Messaging respects consent. People who follow each other can message freely; everyone else goes through a message request that the recipient accepts or declines. Each account chooses whether to accept requests from everyone, followers only, or nobody. Conversations can be muted and individual messages can be removed for one side or both.

Attention is treated as the user's. Quiet hours silence live notification pings during a chosen window without losing anything. Drafts survive a closed tab. There are no infinite-scroll tricks; the feed ends and says so.

Ownership is explicit. Anyone can download a complete JSON export of their own data, block and report accounts, and delete their posts and comments at any time.

The look is hand-drawn. The Sketchbook theme uses ink outlines, paper textures, notebook tabs for navigation and a handwriting display face, in both light and dark variants. It is calm by design and distinctive without being loud.

## Core experience

A new member registers, picks a display name and username, and lands on a home page that doubles as a notebook: a composer at the top, their feed below, and suggestions of people to follow in the margin. Writing a post is immediate; adding a photo prompts for a short description so the image is accessible. Hashtags in the text become links to tag pages.

Explore surfaces public posts and member profiles for discovery. Profiles show a bio, a headline, a link, follower counts and a pinned post. From any profile the member can follow, send a message, block or report.

Messages is a two-pane inbox with pending requests at the top, live presence and typing indicators, read receipts, reactions and a mute toggle in the header. On phones the panes stack and the conversation takes the full screen.

Notifications collect follows, likes, reactions, comments, messages and requests in a single timeline with unread markers. Settings hold theme, profile editing, quiet hours, data export, blocked accounts and sign-out.

## Principles

Calm over compulsive: no ranking, no streaks, no red badges that cannot be cleared in one tap.

Private by default where it matters: followers-only posts, approved follows for private accounts, message requests, muting and blocking are first-class, not buried.

Accessible as drawn: real buttons and links, labelled icon controls, image alt text, visible focus states and colour contrast that holds in both themes.

Small surface, finished edges: every feature that ships is complete, tested and documented rather than half-built.

## Status

Version 1.0 is feature complete for the scope above and deployed as a split architecture: the API on Render, the web app on Vercel, data in MongoDB Atlas and media on Cloudinary. The roadmap in the PRD lists the candidate next steps.
