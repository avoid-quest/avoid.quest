---
"@workspace/scraper": minor
---

## Admin Bot Improvements

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
