# @workspace/scraper

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
