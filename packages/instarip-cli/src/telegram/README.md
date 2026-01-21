# Telegram Module

This module handles sending posts to Telegram and provides an admin bot interface.

## Public API

### `runTelegramOnce()`
Main entry point for sending unsent posts to Telegram. Called by the scheduler or CLI.

```typescript
import { runTelegramOnce } from "./telegram";
await runTelegramOnce();
```

### `startAdminBot()`
Starts the interactive Telegram admin bot for managing the adapter.

```typescript
import { startAdminBot } from "./telegram/admin-bot";
await startAdminBot();
```

## Dependencies

### NPM Packages
- `grammy` - Telegram Bot framework
- `@grammyjs/conversations` - Conversation handling
- `@grammyjs/menu` - Menu building
- `dompurify` - HTML sanitization
- `happy-dom` - DOM implementation for DOMPurify

### Convex API Surface
- `api.posts.getUnsent` - Fetch unsent posts
- `api.posts.markSent` - Mark post as sent
- `api.settings.getSettings` - Get bot settings
- `api.users.*` - User management

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `CONVEX_URL` | Yes | Convex deployment URL |

## Module Structure

```
telegram/
├── index.ts           # runTelegramOnce() - main send loop
├── bot.ts             # Bot instance creation
├── post-sender.ts     # Send individual posts
├── caption-builder.ts # Build post captions
├── media-handler.ts   # Handle media uploads
├── error-handler.ts   # Grammy error handling
├── types.ts           # TypeScript types
├── admin-bot.ts       # Admin bot entry point
└── admin/
    ├── middleware.ts  # Auth and error middleware
    ├── types.ts       # Admin context types
    ├── utils.ts       # Formatting utilities
    ├── menus/         # Interactive menus
    └── commands/      # Command handlers
```

## Future Extraction

This module is designed to be extracted into a separate package. When extracting:

1. Move all files from `src/telegram/` to new package
2. Add dependencies to new package.json
3. Export public API from index.ts
4. Update imports in main CLI package
