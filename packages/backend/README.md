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
```

## Environment Variables

Set environment variables in your Convex deployment:

```bash
npx convex env set VARIABLE_NAME value
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot authentication token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Secret token for webhook validation (see below) |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes | Chat ID authorized to use admin commands |
| `GROQ_API_KEY` | Optional | [Groq API key](https://console.groq.com/) for AI metadata extraction |

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
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<DEPLOYMENT>.convex.site/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
```

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

## Database Schema

All timestamp fields are stored in **milliseconds (UTC)**.

| Table | Purpose |
|-------|---------|
| `posts` | Instagram posts with metadata (shortcode, caption, URLs, media type, sent status) |
| `media_items` | Media files (images/videos) linked to posts, with Telegram file_ids for persistence |
| `users` | Instagram accounts to monitor (username, scraping flags, last scraped timestamp) |
| `telegram_messages` | Sent message tracking (message_id, chat_id, post reference) |
| `settings` | System configuration (telegram, instagram, logging settings) |

### Key Indexes

- `posts.by_timestamp` - Order posts by Instagram publish date
- `posts.by_event_date` - Order posts by event date
- `posts.by_shortcode` - Lookup posts by Instagram shortcode
- `posts.by_sent` - Filter unsent posts for Telegram queue
- `users.by_username` - Lookup users by Instagram username
- `users.by_to_be_scraped_last_scraped_at` - Fetch users due for scraping

## API Reference

### Queries

| Query | Arguments | Description |
|-------|-----------|-------------|
| `getPosts` | `{ limit: number }` | Get posts ordered by event date |
| `getPostById` | `{ id: Id<"posts"> }` | Get a single post by ID |
| `getPostByShortcode` | `{ shortcode: string }` | Get post by Instagram shortcode |
| `getPostsByUserId` | `{ userId: Id<"users"> }` | Get all posts from a user |
| `getUnsent` | `{ limit: number }` | Get unsent posts for Telegram queue |
| `getPostsPaginated` | `{ paginationOpts }` | Paginated post listing |
| `getUsers` | `{}` | Get all users ordered by username |
| `getUserById` | `{ id: Id<"users"> }` | Get a single user by ID |
| `getUserByUsername` | `{ username: string }` | Get user by Instagram username |
| `listToBeScraped` | `{ limit?: number }` | Get users marked for scraping |
| `getSettings` | `{}` | Get system settings |

### Mutations

| Mutation | Description |
|----------|-------------|
| `upsertPost` | Create or update a post |
| `markSent` | Mark a post as sent to Telegram |
| `deletePost` | Delete a post by ID |
| `upsertUser` | Create or update a user |
| `deleteUser` | Delete a user by ID |
| `upsertSettings` | Update system settings |

## Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `fetch instagram posts` | Every hour | Fetches posts for users marked `to_be_scraped` |
| `send telegram posts` | Every 30 minutes | Sends unsent posts to configured Telegram chat |

Cron jobs respect the `active` flag in settings - disable by setting `instagram.active` or `telegram.active` to `false`.

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/telegram/webhook` | Receives Telegram Bot API updates |
| `GET` | `/health` | Health check endpoint (returns `{ status: "ok" }`) |

The webhook endpoint validates requests using the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`.

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

The backend uses Convex local components for external service integration:

- **Instagram component** (`components.instagram`) - Handles Instagram API interactions
- **Telegram component** (`components.telegram`) - Handles Telegram Bot API interactions

### Conventions

- **Timestamps**: All stored in milliseconds (JavaScript `Date.now()` format), UTC timezone
- **File ID strategy**: Telegram `file_id` values are persisted in `media_items` for reliable media re-sending without re-uploading
- **User scraping**: Minimum 30-minute interval between scrapes for the same user

### Connections

- Used by `apps/instarip`: queries posts/users/media for display
- Written by `packages/instagram-adapter`: saves fetched Instagram posts/users/media
