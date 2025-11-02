---
"@workspace/scraper": patch
---

## Fixed

- Fixed `sendMediaGroup` errors by adding comprehensive validation and diagnostic logging

## Changed

- **Removed fallback to individual sends**: When `sendMediaGroup` fails, the error is now thrown with full diagnostic information instead of falling back to sending media individually
- Enhanced error logging with Telegram API error codes and descriptions
- Added pre-send validation for media groups (URL format, media count, caption length)
- Added URL accessibility checks before sending to identify broken/inaccessible media URLs
- Configured auto-retry plugin with exponential backoff for transient errors (rate limits, network issues)

## Added

- Media group validation (`validateMediaGroup`) that checks:
  - Media count constraints (2-10 items)
  - URL format and protocol validation
  - Media type validation
  - Caption length limits
  - Warnings for mixed media types (videos + images)
- URL accessibility validation (`validateMediaUrls`) that:
  - Performs HEAD requests to verify URLs are accessible
  - Logs content types for each media item
  - Reports inaccessible URLs with specific error messages
- Detailed error diagnostics that log:
  - Full media group composition (video/image counts)
  - Complete media item details on failure
  - Specific error code explanations (400, 413, 429)
  - Common causes for known Telegram API issues
- Comprehensive test suite with 18 test cases covering:
  - All error handling scenarios (GrammyError codes 400, 413, 429)
  - Media group validation (count limits, URL validation)
  - URL accessibility checks
  - Fallback mechanisms (tryPrimaryMedia, trySingleValidMedia, sendMessage)
  - Edge cases and integration scenarios
