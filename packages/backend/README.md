# backend

Convex backend for avoid.quest. Database and API for posts, users, media.

## Features

- Tables: posts, users, media_items, settings, post_metadata
- Posts: IG metadata (shortcode, caption, display_url, video_url), media type (image/video/carousel), timestamp/event_date indexes, sent tracking
- Users: username, profile_url, scraping flags (to_be_scraped, last_scraped_at)
- Media items: URLs, dimensions, type (image/video/thumbnail), linked to posts
- Settings: telegram config (chat IDs, cron, send limits), scraper config (cron, limits), logging config, AI metadata extraction config
- Post Metadata: AI-extracted event information (dates, location, organizer, pricing, etc.) with processing status tracking
- Queries: getPosts, getPostById/byShortcode/byUserId, getUsers/byUsername, getMediaItems/byPostId, getSettings, getPostMetadata, getHighConfidenceEvents, getUpcomingEvents
- Mutations: upsertPost, upsertUser, upsertMediaItem, syncMediaItemsForPost, markSent, delete operations, metadata management

## AI Metadata Extraction

The backend includes AI-powered metadata extraction from Instagram post captions using Groq AI:

- **Automatic extraction**: Processes posts via cron job (every 15 minutes)
- **Event detection**: Identifies events with confidence scoring (0-100)
- **Telegram message generation**: Auto-generates formatted messages for high-confidence events (score >= 70)
- **Workflow-based**: Uses Convex Workflows for reliable processing with retry logic

### Environment Variables

- `GROQ_API_KEY` (required): API key for Groq AI service. Get your key from [Groq Console](https://console.groq.com/).

Set this in your Convex deployment:
```bash
npx convex env set GROQ_API_KEY your-api-key-here
```

## Connections

- Used by `apps/instarip`: queries posts/users/media for display
- Written by `packages/scraper`: saves scraped Instagram posts/users/media

