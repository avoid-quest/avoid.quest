# @avoid.quest/backend

## 1.0.0

### Major Changes

- 47ed746: ## Major Backend Refactoring - Component Architecture

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

## 0.1.1

### Patch Changes

- a90a800: ## Monorepo Refactoring & New Packages

  ### New Packages

  - **`@avoid.quest/radio-shared`** - New shared types package for radio platform metadata, Radio types, and platform item responses
  - **`@avoid.quest/radio-audio`** - New audio package extracted from `apps/radio`, containing:
    - AudioManager and audio state management
    - Complete effects system (registry, types, effect manager)
    - React hooks: `useAudio`, `useDjAudio`, `useSingleAudio`
    - Filter types and configurations
  - **`@avoid.quest/soundcloud`** - New SoundCloud platform integration package with:
    - URL detection and item type detection
    - SoundCloud API client with client ID fetching
    - Track and playlist resolution with stream URL extraction
  - **`@avoid.quest/bandcamp`** - New Bandcamp platform integration package with:
    - URL detection and item type detection (album, track, artist, label)
    - HTML parsing and metadata extraction
    - Album and track resolution with stream URL extraction

  ### Audio System Improvements

  - **Added Universal Dry/Wet Controls** - All effects now support unified dry/wet mixing via `UniversalParams` component
  - **Refactored Effect Parameters** - Standardized effect parameter UI across all effect types
  - **Improved Type Safety** - Better type exports and re-exports for audio nodes and effects

  ### Bug Fixes

  - **Fixed Group Volume Calculation** - Fixed division by zero bug when sounds array is empty in Group class
  - **Fixed Audio Player Volume Calculation** - Fixed operator precedence bug in volume calculation (`value[0] ?? 0 / MAX_VOLUME` → `(value[0] ?? 0) / MAX_VOLUME`)
  - **Improved Single Player Mute/Volume Logic** - Enhanced mute handling to automatically unmute when volume is adjusted above zero

  ### UI/UX Improvements

  - **Effect Picker Styling** - Updated max height from `max-h-[32rem]` to standard Tailwind class `max-h-128`
  - **Simplified Tab Labels** - Changed "External Inputs" tab label to "External" for better brevity
  - **Component Cleanup** - Removed unused `artist` prop from PlaylistView component

  ### Type System Enhancements

  - **Cacophony Type Improvements** - Added proper `BiquadFilterNode`, `AudioNode` type exports
  - **Centralized Type Definitions** - Moved shared types to `@avoid.quest/radio-shared` for better reusability
  - **Better Type Compatibility** - Fixed type compatibility issues between cacophony and Web Audio API types

  ### Dependency Updates

  - **Convex** - Updated to `^1.30.0` across backend and scraper packages
  - **Workflow** - Updated `@convex-dev/workflow` to `^0.3.3`
  - **AI SDK** - Updated `ai` package to `^5.0.106`
  - **Cloudflare Types** - Updated `@cloudflare/workers-types` to `^4.20251202.0`
  - **OpenNext** - Updated `@opennextjs/cloudflare` to `^1.14.1`

  ### Infrastructure Changes

  - **Renamed Scripts** - Standardized `check-types` → `typecheck` across all packages
  - **Turbo Tasks** - Added `preview` task to turbo.json pipeline
  - **Biome Config** - Updated to exclude generated Convex server files from linting
  - **TypeScript Configs** - Added proper tsconfig.json files for new packages

  ### Code Quality

  - **Import Consolidation** - Moved all audio-related imports to use `@avoid.quest/radio-audio`
  - **Platform Abstraction** - Extracted platform-specific logic (SoundCloud, Bandcamp) into dedicated packages
  - **Better Separation of Concerns** - Clear boundaries between shared types, audio system, and platform integrations
  - **Parameter Formatters** - Added `linearGain` formatter for proper dB display with -∞ dB handling for zero values
  - **Code Cleanup** - Removed unused constants (`_SESSION_MAX_AGE`) and variables (`_debugLogged`)
  - **Type Improvements** - Removed unnecessary `@ts-expect-error` suppressions after fixing type compatibility issues
  - **Code Formatting** - Improved formatting consistency in audio processor files (phase-vocoder, dattorro-reverb)
