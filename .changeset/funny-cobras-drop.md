---
"@avoid.quest/backend": major
---

## Major Backend Refactoring - Component Architecture

This release introduces a significant architectural refactoring, moving from a monolithic backend to an isolated component-based architecture with improved testability, maintainability, and scalability.

### Breaking Changes

- **Component Architecture Migration** - All Instagram/Telegram functionality moved into isolated Convex components (`/components/instarip/` and `/components/telegram/`). Database access patterns changed to use `components.instarip.*` and `components.telegram.*` APIs instead of direct table queries.

- **Database Schema Changes**
  - All timestamps now stored in **milliseconds** (JavaScript standard, UTC) instead of seconds
  - `posts` table: Added `sending` (boolean), `retry_count` (number), `send_failed` (boolean) fields
  - `media_items` table: Added `file_id` and `file_unique_id` fields for Telegram persistent cache; removed URL storage (only fetched during Instagram requests, not persisted)
  - New `telegram_messages` table for tracking sent messages
  - `fetch_logs` table moved from main app to instarip component

- **Session Storage Format** - Bot sessions now use string-serialized JSON with chat ID as the session key

- **Removed Packages** - CLI scraper package removed (all functionality now in Convex components)

### New Features

- **Telegram File ID System** - Implements persistent Telegram `file_id` caching to prevent media re-uploads. Media builder intelligently prefers `file_id` over URL for sending, with automatic extraction and storage after sends.

- **Standardized Media Validators** - Centralized validators in `/lib/validators/media.ts` with three distinct contexts: Instagram media (URL-based), Telegram media for sending (URL or file_id), and Telegram media for storage (file_id required).

- **Enhanced Instagram Adapter** - Improved caption extraction from multiple response formats, better image URL selection (best quality), carousel post support, robust video handling with thumbnail generation, configurable timeouts, and comprehensive error handling for 404, 429, and other HTTP errors.

- **Telegram Bot Integration** - Pure fetch-based Telegram client supporting media groups (up to 10 items), automatic send strategy determination, rate limiting detection with retry-after handling, and file ID extraction from responses.

- **Granular Settings System** - Component-isolated settings with validators for Telegram (active, group_chat_id, send_limit, timeouts), Instagram (active, limits, scrape intervals, rate limiting), locale (timezone, locale), and logging (active, retention, level).

- **Concurrency & Retry System** - Post claiming mechanism prevents concurrent sends, retry counting with configurable max retries (default 3), send state tracking via `sending` and `send_failed` flags.

- **Rate Limiting** - Token bucket algorithm implementation for Instagram API rate limiting.

- **Interactive Telegram Menus** - New inline menu system for bot administration via `grammY` and `grammy-inline-menu`.

- **Testing Infrastructure** - Comprehensive test suite using vitest + convex-test covering adapters, posts, users, media items, settings, rate limiting, caption building, and API client.

- **HTTP Media Proxy** - New `/httpHandlers/media.ts` endpoint for serving media files.

### Removed Features

- AI-powered metadata extraction agents (`postMetadataExtractorAgent`, `telegramMessageGenerator`)
- Legacy date utilities (moved to `@workspace/shared`)
- Direct database queries (replaced by component APIs)
- URL storage in media_items table (now ephemeral)

### Migration Notes

1. Update database queries to use component APIs: `components.instarip.posts.*` instead of direct table access
2. All timestamps must be in milliseconds (multiply old seconds by 1000 if migrating existing data)
3. Settings must be migrated to new validator structure
4. File IDs for media will be automatically populated on next send
