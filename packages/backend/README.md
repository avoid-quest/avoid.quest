# backend

Convex backend for avoid.quest. Database and API for posts, users, media.

## Prerequisites

- **Bun** (v1.0+) or **Node.js** (v18+)
- **Convex account** - [Sign up at convex.dev](https://convex.dev)
- **Telegram Bot** - Create via [@BotFather](https://t.me/BotFather) on Telegram

## Installation & Setup

```bash
# Install dependencies
bun install

# First-time Convex configuration (creates project and sets up deployment)
bun run dev:setup

# Initialize default settings (idempotent - safe to run multiple times)
bunx convex run bootstrap
```

## Environment Variables

Set environment variables in your Convex deployment:

```bash
bunx convex env set VARIABLE_NAME value
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot authentication token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Secret token for webhook validation (see below) |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes | Chat ID authorized to use admin commands |

### Generating TELEGRAM_WEBHOOK_SECRET

This is a secret you generate yourself - Telegram uses it to sign webhook requests so your backend can verify they're authentic. See [Telegram Bot API - setWebhook](https://core.telegram.org/bots/api#setwebhook) for details.

```bash
# Generate a random secret (use openssl or similar)
openssl rand -hex 32
```

Allowed characters: `A-Z`, `a-z`, `0-9`, `_`, `-` (1-256 characters).

### Setting up the Telegram webhook

After deploying, configure your bot's webhook URL:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<DEPLOYMENT>.convex.site/telegram/instarip/webhook&secret_token=<WEBHOOK_SECRET>"
```

> **Note:** The legacy path `/telegram/webhook` is still supported for backward compatibility but deprecated.

## Development

```bash
# Start Convex dev server (watches for changes, syncs with Convex cloud)
bun run dev
```

## Deployment

```bash
# Deploy to production
bun run deploy
```

## Testing

```bash
# Run tests
bun run test

# Run tests in watch mode
bun run test:watch
```

Tests use `vitest` with `convex-test` for database integration testing.

## Settings Management

Settings are stored in the `settings` table within the **instarip component** and provide runtime configuration for all services. Values merge with compile-time defaults from `lib/config/defaults.ts`.

### Initializing Default Settings

Run the bootstrap action to create default settings:

```bash
# Manual initialization
bunx convex run bootstrap

# On deploy (preview environments)
bunx convex deploy --preview-run "bootstrap"
```

The bootstrap action is idempotent - it creates settings only if none exist, otherwise returns the existing settings.

### Configuration Hierarchy

```
defaults.ts (compile-time) → database settings (runtime) → env vars (secrets only)
```

### Telegram Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `active` | boolean | `false` | Enable/disable Telegram sending |
| `group_chat_id` | string? | - | Chat ID for post delivery |
| `send_limit` | number? | `3` | Max posts per cron run |
| `send_report` | boolean | `false` | Send summary report after batch |
| `request_timeout_ms` | number? | `30000` | API request timeout |
| `delay_between_posts_ms` | number? | `500` | Delay between sending posts |

### Instagram Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `active` | boolean | `false` | Enable/disable Instagram scraping |
| `limit` | number? | `5` | Max users to scrape per cron run |
| `post_per_user` | number? | `20` | Max posts to fetch per user |
| `request_timeout_ms` | number? | `10000` | API request timeout |
| `min_scrape_interval_ms` | number? | `1800000` | Min interval between user scrapes (30 min) |
| `delay_between_users_min_ms` | number? | `10000` | Min delay between users |
| `delay_between_users_max_ms` | number? | `30000` | Max delay between users |
| `rate_limit_max_tokens` | number? | `3` | Rate limiter burst capacity |
| `rate_limit_refill_rate` | number? | `0.5` | Rate limiter refill per second |

### Locale Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timezone` | string? | `Europe/Rome` | Timezone for date formatting |
| `locale` | string? | `it-IT` | Locale for date/number formatting |

### Logging Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `active` | boolean | `false` | Enable/disable logging |
| `max_retention_days` | number? | - | Log retention period |
| `log_file` | string? | - | Log file path |
| `log_level` | string? | - | Log level (debug, info, warn, error) |

### Updating Settings

Use the `upsertSettings` mutation from the instarip component:

```typescript
// Enable Telegram sending with custom limit
await ctx.runMutation(components.instarip.settings.upsertSettings, {
  telegram: {
    active: true,
    send_limit: 5,
    send_report: true,
  },
});

// Update existing settings (pass the settings ID)
await ctx.runMutation(components.instarip.settings.upsertSettings, {
  id: existingSettingsId,
  instagram: {
    active: true,
    limit: 10,
  },
});
```

### Resolving Configuration

Use the config resolver functions to merge database settings with defaults:

```typescript
import { resolveConfig, resolveTelegramConfig } from "./lib/config";

// Get settings from the instarip component
const settings = await ctx.runQuery(components.instarip.settings.getSettings, {});
const config = resolveConfig(settings);

// Or resolve individual sections
const telegramConfig = resolveTelegramConfig(settings?.telegram);
console.log(telegramConfig.sendLimit); // Returns DB value or default (3)
```

## Database Schema

The backend uses a **component-based architecture**. Each component owns its tables in isolated namespaces.

All timestamp fields are stored in **milliseconds (UTC)**.

### Main App Schema

| Table | Purpose |
|-------|---------|
| `bot_sessions` | Telegram bot session storage (key-value for grammY sessions) |

### Instarip Component (`components.instarip`)

| Table | Purpose |
|-------|---------|
| `posts` | Instagram posts with metadata (shortcode, caption, URLs, media type, sent status) |
| `media_items` | Media files (images/videos) linked to posts, with Telegram file_ids for persistence |
| `users` | Instagram accounts to monitor (username, scraping flags, last scraped timestamp) |
| `telegram_messages` | Sent message tracking for posts (message_id, chat_id, post reference) |
| `settings` | System configuration (telegram, instagram, locale, logging settings) |
| `fetch_logs` | Instagram fetch operation logs (username, timestamp, posts fetched, success/error) |

### Telegram Component (`components.telegram`)

| Table | Purpose |
|-------|---------|
| `sent_messages_log` | General message send log (message_id, chat_id, type, success/error) |

### Key Indexes

**Instarip Component:**
- `posts.by_timestamp` - Order posts by Instagram publish date
- `posts.by_event_date` - Order posts by event date
- `posts.by_shortcode` - Lookup posts by Instagram shortcode
- `posts.by_sent` - Filter unsent posts for Telegram queue
- `users.by_username` - Lookup users by Instagram username
- `users.by_to_be_scraped_last_scraped_at` - Fetch users due for scraping
- `media_items.by_post_id` - Get media items for a post
- `fetch_logs.by_username` - Get fetch history for a user

**Telegram Component:**
- `sent_messages_log.by_chat_id` - Messages by chat
- `sent_messages_log.by_sent_at` - Messages by timestamp

## API Reference

APIs are accessed through **component namespaces**. Use `components.instarip.*` and `components.telegram.*` to access component functions.

### Main App

| Function | Type | Description |
|----------|------|-------------|
| `api.bootstrap.bootstrap` | Action | Initialize default settings (idempotent) |
| `internal.crons.runTelegramSend` | Action | Send unsent posts to Telegram |
| `internal.crons.runInstagramFetch` | Action | Fetch posts from Instagram users |

### Instarip Component (`components.instarip`)

**Posts:**

| Function | Type | Description |
|----------|------|-------------|
| `posts.getPosts` | Query | Get posts ordered by event date |
| `posts.getPostById` | Query | Get a single post by ID |
| `posts.getPostByShortcode` | Query | Get post by Instagram shortcode |
| `posts.getUnsent` | Query | Get unsent posts for Telegram queue |
| `posts.upsertPost` | Mutation | Create or update a post |
| `posts.markSent` | Mutation | Mark a post as sent to Telegram |
| `posts.deletePost` | Mutation | Delete a post by ID |

**Users:**

| Function | Type | Description |
|----------|------|-------------|
| `users.getUsers` | Query | Get all users ordered by username |
| `users.getUserById` | Query | Get a single user by ID |
| `users.getUserByUsername` | Query | Get user by Instagram username |
| `users.listToBeScraped` | Query | Get users marked for scraping |
| `users.upsertUser` | Mutation | Create or update a user |
| `users.deleteUser` | Mutation | Delete a user by ID |

**Media Items:**

| Function | Type | Description |
|----------|------|-------------|
| `mediaItems.getMediaItemsByPostId` | Query | Get media items for a post |
| `mediaItems.syncMediaItemsForPost` | Mutation | Sync media items for a post |

**Settings:**

| Function | Type | Description |
|----------|------|-------------|
| `settings.getSettings` | Query | Get system settings |
| `settings.upsertSettings` | Mutation | Update system settings |
| `settings.ensureSettings` | Mutation | Create default settings if none exist |

**Fetcher:**

| Function | Type | Description |
|----------|------|-------------|
| `fetcher.fetchUser` | Action | Fetch posts for an Instagram user |
| `fetcher.fetchPost` | Action | Fetch a single Instagram post by URL |

### Telegram Component (`components.telegram`)

| Function | Type | Description |
|----------|------|-------------|
| `sender.sendMessage` | Action | Send a post to Telegram (handles media groups) |
| `sender.sendTextMessage` | Action | Send a text message to Telegram |
| `sender.verifyBotToken` | Action | Verify bot token with Telegram API |

## Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `fetch instagram posts` | Every hour | Fetches posts for users marked `to_be_scraped` |
| `send telegram posts` | Every 30 minutes | Sends unsent posts to configured Telegram chat |

Cron jobs respect the `active` flag in settings - disable by setting `instagram.active` or `telegram.active` to `false`.

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/telegram/instarip/webhook` | Primary webhook for Instarip bot |
| `POST` | `/telegram/webhook` | Legacy webhook (deprecated, redirects to Instarip) |
| `GET` | `/media` | Media proxy endpoint for serving media files |
| `OPTIONS` | `/media` | CORS preflight for media endpoint |
| `GET` | `/health` | Health check endpoint (returns `{ status: "ok" }`) |

### Webhook Security

The webhook endpoint validates requests using:
- `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`
- Admin authorization - only messages from `TELEGRAM_ADMIN_CHAT_ID` are processed

### Media Proxy

The `/media` endpoint serves media files with caching headers:

```
GET /media?id=<media_item_id>
```

Returns the media file with appropriate content-type and aggressive caching.

## Telegram Bot Commands

Commands are only accepted from the chat ID matching `TELEGRAM_ADMIN_CHAT_ID`.

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show available commands |
| `/status` | Show system status (active services, last run times) |
| `/stats` | Show database statistics (unsent posts, active users) |
| `/trigger instagram` | Manually trigger Instagram fetch |
| `/trigger telegram` | Manually trigger Telegram send |
| `/post add <url>` | Fetch and save an Instagram post |
| `/post preview <url>` | Preview an Instagram post without saving |

## Architecture

### Component-Based Design

The backend uses Convex local components for separation of concerns:

```
packages/backend/convex/
├── components/
│   ├── instarip/          # Instagram data component
│   │   ├── posts.ts       # Post CRUD operations
│   │   ├── users.ts       # User management
│   │   ├── mediaItems.ts  # Media item management
│   │   ├── settings.ts    # Settings management
│   │   ├── fetcher.ts     # Instagram API fetching
│   │   └── adapter.ts     # Instagram API adapter
│   └── telegram/          # Telegram sending component
│       ├── sender.ts      # Message sending
│       └── lib/           # API client, caption builder, etc.
├── instarip/              # App-specific Telegram bot
│   ├── bot.ts             # grammY bot setup
│   ├── webhook.ts         # Webhook handler
│   ├── handlers/          # Message handlers
│   └── menu/              # Inline button menus
├── crons.ts               # Orchestration layer
└── http.ts                # HTTP routes
```

**Component Responsibilities:**

- **Instarip Component** (`components.instarip`) - All Instagram-related data and operations (posts, users, media items, settings, fetching)
- **Telegram Component** (`components.telegram`) - Reusable Telegram API client for sending messages
- **Instarip App** (`instarip/`) - App-specific Telegram bot logic (menus, handlers, webhook)
- **Main App** - Cron orchestration and HTTP routing

### Conventions

- **Timestamps**: All stored in milliseconds (JavaScript `Date.now()` format), UTC timezone
- **File ID strategy**: Telegram `file_id` values are persisted in `media_items` for reliable media re-sending without re-uploading
- **User scraping**: Minimum 30-minute interval between scrapes for the same user
- **Sending**: Atomic `claimForSending` prevents concurrent sends with retry logic

### Connections

- **Main App** orchestrates cron jobs that call component functions
- **Instarip Component** owns all data tables
- **Telegram Component** provides reusable sending infrastructure
- **Instarip App** provides admin bot interface
