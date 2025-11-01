---
"@workspace/scraper": major
---

Moved to Convex 🫠

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
