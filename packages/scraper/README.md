# scraper

Instagram scraper CLI with cron scheduler and Telegram bot integration.

## Features

- Instagram scraping: fetch posts from IG users, extract media (images/videos), metadata (caption, timestamp, shortcode)
- Convex integration: saves posts/users/media_items to backend, handles upserts, syncs media items
- Cron scheduler: configurable schedule via Convex settings, auto-run scraping jobs
- Telegram bot: sends unsent posts to configured chat (admin/group), rate limiting, cron-based sending, reports
- CLI commands: `bun start` (full system), `bun scrape` (run once), `bun telegram` (send once), `bun start-both` (both)
- Settings: telegram config (chat IDs, cron, send limits), scraper config (cron, post limits), loaded from Convex

## Connections

- Writes to `packages/backend`: saves posts/users/media via Convex mutations
- Data displayed in `apps/instarip`: scraped posts shown in feed
