---
"@workspace/scraper": patch
---

Refactored telegram implementation into modular structure and added comprehensive test suite.

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
