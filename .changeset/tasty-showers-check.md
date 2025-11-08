---
"@workspace/scraper": minor
---

## AI-Powered Metadata Extraction & Date Utilities

### AI Integration

- **Added Groq AI SDK integration** (`@ai-sdk/groq`) for intelligent content analysis
- **Post metadata extraction agent** - Automatically extracts event information from Instagram post captions:
  - Event detection with confidence scoring (0-100)
  - Date and time extraction (supports incomplete dates, relative dates, time ranges)
  - Location extraction (venue, address, city)
  - Event type classification (concert, workshop, conference, festival, exhibition, meetup, other)
  - Organizer identification from @mentions and hashtags
  - Pricing and registration information
  - Hashtag and language detection
- **Telegram message generator** - AI-powered generation of formatted Telegram messages from extracted metadata:
  - **Original caption fidelity** - Prioritizes exact preservation of original caption text over grammar perfection
  - **Automatic @username link conversion** - Converts Instagram @mentions to full Instagram profile links for proper Telegram rendering
  - **Minimal rewriting** - Preserves relative dates ("domani", "oggi"), emoji, punctuation, and original structure
  - **Metadata as supplement only** - Uses extracted metadata only for missing essential information, not to rewrite original text
- **Structured output validation** - Uses Zod schemas for type-safe AI responses
- **Isolated thread context** - Each post extraction gets its own agent thread for proper context separation

### Workflow System

- **Convex Workflow integration** - Automated processing pipeline for metadata extraction
- **Cron job automation** - Scheduled processing of metadata backlog (configurable interval, batch size, concurrency)
- **Error handling** - Comprehensive error tracking and retry logic for failed extractions
- **Processing status tracking** - Tracks pending, processing, completed, and failed states

### Date & Time Utilities

- **Centralized date utilities** - Consistent timestamp handling across the codebase
- **Timezone-aware formatting** - All date formatting uses Europe/Rome timezone with it-IT locale
- **Timestamp standardization** - All timestamps stored in milliseconds (JavaScript standard)
- **Conversion utilities** - Helper functions for seconds/milliseconds conversion (for Instagram API compatibility)
- **Multiple formatting functions** - Support for AI context, logging, event display, and short date formats

### Scraper Improvements

- **Updated to use centralized date utilities** - Consistent timestamp handling throughout scraper codebase
- **Improved timestamp accuracy** - Proper conversion from Instagram API seconds to internal milliseconds format
