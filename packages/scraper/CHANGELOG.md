# @workspace/scraper

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
