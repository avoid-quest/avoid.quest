# @workspace/scraper

## 3.2.3

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

- Updated dependencies [a90a800]
  - @workspace/backend@0.1.1

## 3.2.2

### Patch Changes

- 760e001: chore: bump deps

## 3.2.1

### Patch Changes

- c6cadf0: Fix lint issues: replace increment/decrement operators with += 1, add explicit type annotations, and refactor sendPost function to reduce complexity from 40 to below 15.

## 3.2.0

### Minor Changes

- e8393b5: ## AI-Powered Metadata Extraction & Date Utilities

  ### AI Integration

  - **Added Groq AI SDK integration** (`@ai-sdk/groq`) for intelligent content analysis
  - **Post metadata extraction agent** - Automatically extracts event information from Instagram post captions:
    - Event detection with confidence scoring (0-100)
    - Date and time extraction (supports incomplete dates, relative dates, time ranges)
    - Location extraction (venue, address, city)
    - Event type classification (concert, workshop, conference, festival, exhibition, meetup, other)
    - Organizer identification from @mentions and hashtags
    - Pricing and registration information
    - Hashtag and language detection
  - **Telegram message generator** - AI-powered generation of formatted Telegram messages from extracted metadata:
    - **Original caption fidelity** - Prioritizes exact preservation of original caption text over grammar perfection
    - **Automatic @username link conversion** - Converts Instagram @mentions to full Instagram profile links for proper Telegram rendering
    - **Minimal rewriting** - Preserves relative dates ("domani", "oggi"), emoji, punctuation, and original structure
    - **Metadata as supplement only** - Uses extracted metadata only for missing essential information, not to rewrite original text
  - **Structured output validation** - Uses Zod schemas for type-safe AI responses
  - **Isolated thread context** - Each post extraction gets its own agent thread for proper context separation

  ### Workflow System

  - **Convex Workflow integration** - Automated processing pipeline for metadata extraction
  - **Cron job automation** - Scheduled processing of metadata backlog (configurable interval, batch size, concurrency)
  - **Error handling** - Comprehensive error tracking and retry logic for failed extractions
  - **Processing status tracking** - Tracks pending, processing, completed, and failed states

  ### Date & Time Utilities

  - **Centralized date utilities** - Consistent timestamp handling across the codebase
  - **Timezone-aware formatting** - All date formatting uses Europe/Rome timezone with it-IT locale
  - **Timestamp standardization** - All timestamps stored in milliseconds (JavaScript standard)
  - **Conversion utilities** - Helper functions for seconds/milliseconds conversion (for Instagram API compatibility)
  - **Multiple formatting functions** - Support for AI context, logging, event display, and short date formats

  ### Scraper Improvements

  - **Updated to use centralized date utilities** - Consistent timestamp handling throughout scraper codebase
  - **Improved timestamp accuracy** - Proper conversion from Instagram API seconds to internal milliseconds format

## 3.1.1

### Patch Changes

- 5917f01: ## Graceful Shutdown Improvements

  ### Signal Handling

  - **Added proper SIGTERM and SIGINT handlers** to the `start` command for graceful shutdown
  - **Prevents double Ctrl+C requirement** - first signal triggers graceful shutdown, subsequent signals are handled properly
  - **Graceful scheduler cleanup** - stops all cron jobs before exiting
  - **Shutdown flag protection** - prevents race conditions during shutdown process

  ### Systemd Integration

  - **Updated systemd service configuration** with proper termination settings:
    - `KillMode=mixed` - sends SIGTERM to main process first
    - `TimeoutStopSec=30` - allows 30 seconds for graceful shutdown
    - `SendSIGKILL=yes` - force-kills if process doesn't exit within timeout
  - **Improved service reliability** - systemd can now properly stop the service with `systemctl stop`

  ### User Experience

  - Clear shutdown messages indicating graceful shutdown in progress
  - No more hanging processes requiring multiple Ctrl+C presses
  - Proper cleanup of resources before exit

## 3.1.0

### Minor Changes

- 0601d40: ## Admin Bot Improvements

  ### Command Simplification

  - **Removed redundant commands** that duplicate menu functionality: `/help`, `/status`, `/stats`, `/settings`, `/user`, `/posts`
  - **Kept only `/start` as the required command** for initial access
  - **Retained quick-action commands** that align with CLI functionality: `/post`, `/preview`, `/trigger`
  - All main features are now accessible through the interactive menu system

  ### Security Enhancements

  - **Strengthened authentication middleware** with explicit checks for all update types (messages, callback queries, etc.)
  - **Verified admin chat ID validation** ensures only the designated admin from database settings can access the bot
  - Added comprehensive security documentation and comments
  - Improved chat ID extraction from multiple sources to handle all Telegram update types securely

  ### Code Quality

  - Fixed all linting issues (noShadow, useMaxParams, noExportedImports)
  - Removed unused command handlers (`help.ts`, `user.ts`)
  - Refactored pagination utilities to use options object pattern
  - Improved error handling and logging throughout

  ### User Experience

  - Added "🏠 Home" button to all menus for easy navigation
  - Fixed pagination issues (next/prev buttons now work correctly)
  - Reduced items per page from 15 to 5 for better readability
  - Improved callback query handling for all menu interactions

## 3.0.3

### Patch Changes

- 0eb3279: Refactored telegram implementation into modular structure and added comprehensive test suite.

  ## Changes

  ### Refactoring

  - Split monolithic `telegram/index.ts` into modular structure:
    - `bot.ts` - Bot initialization with auto-retry and error handling
    - `types.ts` - Type definitions and constants
    - `media-handler.ts` - Media validation, filtering, and group building
    - `caption-builder.ts` - HTML sanitization, truncation, and mention linking
    - `error-handler.ts` - Enhanced error logging and Telegram API error handling
    - `post-sender.ts` - Main sending logic with progressive fallback strategies
    - `index.ts` - Public API orchestration (maintains backward compatibility)

  ### Features Ported from Legacy

  - Advanced media validation with URL accessibility checks
  - HTML sanitization for Telegram (simplified, no DOMPurify dependency)
  - HTML-aware caption truncation preserving Instagram links
  - Progressive fallback strategies (media group → single media → text)
  - Video thumbnail detection and correction
  - Enhanced error handling with specific error code handling
  - Proper @mention linking to Instagram profiles

  ### Testing

  - Added comprehensive test suite using Bun's test runner:
    - `caption-builder.test.ts` - 17 tests for caption building and HTML handling
    - `media-handler.test.ts` - 10 tests for media validation and group building
    - `error-handler.test.ts` - 11 tests for error handling
    - `types.test.ts` - 4 tests for type constants
    - Total: 42 tests, all passing

  ### Improvements

  - Strong typing throughout (no `any` types)
  - Clear separation of concerns
  - Reusable utility functions
  - Comprehensive logging
  - Maintains backward compatibility with existing `runTelegramOnce()` API

## 3.0.2

### Patch Changes

- 578abb9: Fix croner API bug and add comprehensive test suite

  - **Fixed**: Replaced incorrect `.next()` method calls with `.nextRun()` to match croner v9.1.0 API
  - **Added**: Comprehensive test suite for scheduler module using Bun's test framework
  - **Added**: Test script (`bun test`) to package.json
  - **Added**: GitHub Actions CI workflow for automated testing on push/PR
  - **Improved**: Code structure by extracting helper functions to reduce complexity
  - **Improved**: Type safety by removing unnecessary optional chaining and type casts
  - **Improved**: Removed magic numbers by extracting time constants

  All tests passing (15/15). The scheduler now correctly handles cron job creation, error handling, and state management.

## 3.0.1

### Patch Changes

- 5ed7021: Enhanced scheduler with comprehensive logging and visibility

  ## Added

  - **Logging system integration**: Scheduler now uses the logger infrastructure with `DEBUG=1` environment variable support
  - **Settings visibility**: Logs loaded settings at debug level (scraper/telegram active status, cron expressions)
  - **Job creation logging**: Logs success/failure when creating cron jobs with next run times
  - **Error handling**: Added try-catch blocks in cron job callbacks with detailed error logging and stack traces
  - **Next runs display**: Added "Next Runs" section in `start` command showing when scraper and telegram jobs are scheduled
  - **Status API**: Exported `getSchedulerStatus()`, `getScraperNextRun()`, and `getTelegramNextRun()` functions for status queries

  ## Improved

  - **Debugging experience**: Full visibility into why jobs aren't running (missing settings, invalid cron expressions, execution errors)
  - **Error recovery**: Cron job failures no longer crash the scheduler - errors are logged and execution continues
  - **User feedback**: Clear indication of job status and next scheduled runs on startup

## 3.0.0

### Major Changes

- 5fd445c: ### 🛠️ Build System Improvements

  - **Fixed cross-compilation targets**: Updated build scripts to use correct Bun target format (`bun-linux-x64`, `bun-darwin-x64`, etc.) instead of invalid targets, fixing GitHub Actions build failures
  - **Reorganized build output**: All compiled executables now output to the `out/` folder for better organization and cleaner project structure
  - **Fixed version retrieval**: Replaced runtime `package.json` reading with build-time constant injection using Bun's `--define` flag, resolving version command failures in compiled executables

  ### 📦 Changes

  - Build scripts now properly read version from `package.json` and embed it at compile time
  - Version command now works correctly in standalone executables without requiring access to `package.json`
  - All platform-specific builds (Linux, macOS x64/ARM64, Windows) now compile successfully

## 2.0.0

### Major Changes

- 2b6d805: 🎉 Moved to Convex 🫠

  This major release represents a complete refactoring of the scraper package, migrating to Convex as the primary database backend.

  ### ✨ Core Features

  #### 🔍 Instagram Scraping

  - Automated profile scraping with configurable post limits
  - Single post scraping via URL with optional database storage
  - Smart selection algorithms for efficient scraping
  - Rate limiting and error handling with retry mechanisms
  - Media extraction (images, videos, thumbnails) via Instagram oEmbed API

  #### 📤 Telegram Bot Integration

  - Automated posting of scraped content to Telegram
  - Configurable limits and send-only modes
  - Real-time notifications for new posts
  - Auto-retry functionality with exponential backoff

  #### ⏰ Cron Scheduling

  - Built-in cron scheduler for automated jobs
  - Configurable scraping schedules
  - Configurable telegram posting schedules
  - Background job management with status monitoring

  #### 💻 CLI Interface

  - Comprehensive command-line interface with intuitive commands
  - Production-ready `start` command for full system deployment
  - Development/testing commands for immediate execution
  - Built-in help system and verbose logging options

  ### 🛠️ Commands

  **Production:**

  - `start` - Start full system with cron scheduler (recommended for production)

  **Development/Testing:**

  - `scrape` - Run scraping job immediately
  - `telegram` - Run telegram job immediately
  - `start-both` - Run both jobs in sequence immediately
  - `single-post` - Scrape individual Instagram posts by URL

  **Management:**

  - `cron` - Manage scheduled jobs (start, status)
  - `user` - Manage users in database (list, add, stats)
  - `settings` - Manage application settings (list, get, set, reload, init)
  - `admin` - Interactive Telegram admin bot

  ### 🔧 Technical Highlights

  - **Bun Runtime**: Built with Bun for exceptional performance
  - **Cross-Platform**: Compiles to native executables (Linux, macOS x64/ARM64, Windows)
  - **Type-Safe**: Full TypeScript support with strict typing
  - **Convex Integration**: Real-time database with automatic synchronization
  - **Modular Architecture**: Clean separation of concerns (scraping, telegram, scheduling, settings)

  ### 📦 What's New

  - Migrated from previous database solution to Convex
  - Enhanced error handling and retry logic
  - Improved CLI with better help system
  - Optimized scraping algorithms
  - Better rate limiting and infrastructure utilities
