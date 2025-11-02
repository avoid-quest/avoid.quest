# backend

Convex backend for avoid.quest. Database and API for posts, users, media.

## Features

- Tables: posts, users, media_items, settings
- Posts: IG metadata (shortcode, caption, display_url, video_url), media type (image/video/carousel), timestamp/event_date indexes, sent tracking
- Users: username, profile_url, scraping flags (to_be_scraped, last_scraped_at)
- Media items: URLs, dimensions, type (image/video/thumbnail), linked to posts
- Settings: telegram config (chat IDs, cron, send limits), scraper config (cron, limits), logging config
- Queries: getPosts, getPostById/byShortcode/byUserId, getUsers/byUsername, getMediaItems/byPostId, getSettings
- Mutations: upsertPost, upsertUser, upsertMediaItem, syncMediaItemsForPost, markSent, delete operations

## Connections

- Used by `apps/instarip`: queries posts/users/media for display
- Written by `packages/scraper`: saves scraped Instagram posts/users/media

