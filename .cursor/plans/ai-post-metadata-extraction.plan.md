<!-- 9e00dff4-3a7d-4050-b4e1-0449590111ec 2feac4bf-f4db-4977-974d-7329b4c88918 -->
# AI Post Metadata Extraction System - Refined Plan

## Overview

Implement an AI-driven metadata extraction system that automatically processes Instagram posts to extract event-related information. The system uses Convex workflows for durable, queued processing, Google Gemini (free tier) for AI extraction, and stores results in a dedicated `post_metadata` table. All posts (new and existing) will be processed, with new posts queued immediately and existing posts processed gradually.

## Architecture Components

### 1. Database Schema Changes

#### New Table: `post_metadata`

Location: `packages/backend/convex/schema.ts`

**Core Event Fields:**

- `post_id`: Id<"posts"> - Reference to posts table (unique index)
- `event_score`: number (0-100) - AI confidence this is an event
- `event_date_start`: Optional number (timestamp) - Start date/time
- `event_date_end`: Optional number (timestamp) - End date/time (multi-day events)
- `event_time_start`: Optional string - Start time (e.g., "19:00", "7:00 PM")
- `event_time_end`: Optional string - End time
- `location`: Optional string - Venue/location name
- `location_address`: Optional string - Full address if available
- `location_coordinates`: Optional object `{lat: number, lng: number}` - Geocoded coordinates

**Event Details:**

- `event_type`: Optional string - Category enum: "concert" | "workshop" | "conference" | "festival" | "exhibition" | "meetup" | "other"
- `event_title`: Optional string - Extracted event name/title
- `organizer_name`: Optional string - Event organizer/host
- `organizer_contact`: Optional string - Contact info (email, phone, social handle)
- `target_audience`: Optional array<string> - Audience tags (e.g., ["professionals", "students"])
- `registration_required`: Optional boolean - Whether registration needed
- `registration_url`: Optional string - Registration link
- `ticket_price`: Optional string - Price info (e.g., "Free", "$20", "€15-30")
- `event_description`: Optional string - Cleaned/summarized description
- `hashtags`: Optional array<string> - Relevant hashtags extracted
- `keywords`: Optional array<string> - Key terms for searchability
- `language`: Optional string - Detected language code (e.g., "en", "it", "es")
- `content_type`: Optional "event_announcement" | "event_reminder" | "event_recap" | "other"

**Telegram Optimization:**

- `telegram_message`: Optional string - Pre-formatted HTML caption text (max 1024 chars, Telegram-safe, includes Instagram link footer)

**Processing Metadata:**

- `processing_status`: "pending" | "processing" | "completed" | "failed"
- `processing_started_at`: Optional number (timestamp)
- `processing_completed_at`: Optional number (timestamp)
- `processing_error`: Optional string - Error message if failed
- `ai_model_used`: Optional string - Model identifier (e.g., "gemini-2.5-flash")
- `extraction_version`: number - Version of extraction logic (starts at 1)

**Indexes:**

- `by_post_id` - Unique index on `post_id` for fast lookups
- `by_event_score` - Index on `event_score` for filtering high-confidence events
- `by_event_date_start` - Index on `event_date_start` for date-based queries
- `by_processing_status` - Index on `processing_status` for monitoring/queue management
- `by_event_type` - Index on `event_type` for category filtering

#### Update `posts` Table:

- Add `metadata_id`: Optional Id<"post_metadata"> - Reference to extracted metadata
- Allows easy joining while keeping metadata separate

### 2. Convex Workflow Implementation

#### Workflow Package Setup

Location: `packages/backend/convex/workflows/`

**Installation:**

- Add `@convex-dev/workflow` dependency
- Create `workflow.ts` with `WorkflowManager` initialization
- Register workflow component in Convex dashboard

#### Workflow: `processPostMetadata`

Location: `packages/backend/convex/workflows/postMetadata.ts`

**Workflow Definition:**

Uses `workflow.define()` with steps:

1. Mark metadata as "processing"
2. Load post data via query
3. Extract metadata via AI action (with retry)
4. Generate Telegram messages via mutation
5. Save metadata and link to post

**Workflow Features:**

- Durable execution (survives restarts)
- Automatic retry on transient failures (3 attempts, exponential backoff)
- Rate limiting via workflow queue (processes sequentially by default)
- Idempotency check (skip if metadata already exists)
- Error handling with status tracking

**Workflow Triggering:**

- **New Posts**: Triggered from `upsertPost` mutation when new post inserted
- **Existing Posts**: Triggered by scheduled cron job that processes backlog gradually

### 3. AI Agent Implementation

#### Agent: `postMetadataExtractor`

Location: `packages/backend/convex/ai/postMetadataExtractor.ts`

**Implementation Details:**

- Uses AI SDK 6 `generateObject` with Zod schema
- Google Gemini provider (`@ai-sdk/google`)
- Model: `gemini-2.5-flash` (fast, free tier compatible)
- Structured output via Zod schema matching `post_metadata` fields
- Text-only processing (captions only, no images)

**Zod Schema:**

Defines all metadata fields with proper types, optional fields, and enums for `event_type`.

**Prompt Strategy:**

- System prompt: Defines event extraction task, output format, examples. Includes definition of what constitutes an "event" (refinable through prompt engineering - e.g., gatherings, performances, workshops, meetups, concerts, conferences, festivals, exhibitions, etc.). The AI should determine event_score (0-100) based on presence of dates, locations, times, event keywords, and other indicators.
- User prompt: Post caption text
- Few-shot examples for better accuracy
- Date/time parsing: Assume Rome/Italy timezone (UTC+1/UTC+2) for event dates unless explicitly stated otherwise in the caption
- Event score: AI determines confidence percentage (0-100) that the post describes an event. No separate "is an event" boolean field - the score itself indicates confidence level

**Error Handling:**

- Catch API errors and return structured error
- Handle rate limits with exponential backoff
- Validate output against schema before returning
- Retry on transient failures (via workflow retry mechanism)
- After retries exhausted, mark as "failed" with error message
- Admin can manually fill metadata for failed extractions via admin mutations

### 4. Telegram Message Generation

#### Function: `generateTelegramMessage`

Location: `packages/backend/convex/ai/telegramMessageGenerator.ts`

**Implementation:**

- Takes extracted metadata and post URL
- Generates caption text only (media is handled separately by post-sender)
- **Message format**: Text content (max 1024 chars) that fits within Telegram limits, ending with Instagram link
- AI should generate text that is properly formatted and doesn't cut words/sentences in the middle
- Uses Telegram HTML formatting (`<b>`, `<i>`, `<a>`) for formatting
- Handles missing fields gracefully
- Smart truncation that preserves sentence/word boundaries (better than current hard truncation)
- Escapes HTML entities properly
- Format: Event details (title, date, location, description, price) + Instagram link footer

### 5. Integration Points

#### Update `upsertPost` Mutation

Location: `packages/backend/convex/posts.ts`

**Changes:**

- After inserting new post (not update), start workflow using `workflow.start()`
- Only trigger for new posts (when `id` is undefined)
- If post caption is updated (existing post with new caption), automatically trigger re-extraction by starting workflow again
- Workflow will check if metadata exists and update it rather than creating duplicate

#### Backlog Processing Cron

Location: `packages/backend/convex/crons.ts` (new file)

**Cron Job:**

- Runs based on API rate limits (Google Gemini free tier: ~15 requests per minute)
- Finds posts without metadata (`metadata_id` is null)
- Processes in batches calculated to respect rate limits
- Starts workflows for each post with appropriate spacing
- Dynamically adjusts batch size based on current API usage

#### Update Telegram Service

Location: `packages/scraper/src/telegram/caption-builder.ts`

**Changes:**

- Query post with metadata joined
- If `metadata.telegram_message` exists, use it directly as the caption text
- Message format matches current style: media first (handled by post-sender), then caption text (from metadata), then Instagram link
- AI-generated text should be properly formatted and not cut in the middle of words/sentences (better than current hard truncation)
- Fallback to current `createCaption` function if no metadata
- Eliminates real-time processing during Telegram sends

### 6. Configuration & Settings

#### New Settings Table Fields

Location: `packages/backend/convex/settings.ts`

**AI Processing Settings:**

- `ai_metadata_extraction`: Object with:
  - `enabled`: boolean - Master switch
  - `model`: string - Gemini model name (default: "gemini-2.5-flash")
  - `batch_size`: number - Posts per backlog processing run (calculated based on API rate limits)
  - `backlog_interval_minutes`: number - Minutes between backlog runs (calculated to respect rate limits)
  - `max_concurrent_workflows`: number - Max parallel workflows (default: 1 to respect rate limits)

### 7. Free Tier Optimization (Google Gemini)

**Strategies:**

- Use `gemini-2.5-flash` (fastest, most cost-effective)
- Implement request queuing via workflow system (processes sequentially by default)
- Batch backlog processing to avoid rate limit spikes
- Use structured outputs to reduce token usage
- Implement smart retry with exponential backoff
- Monitor API usage via Google Cloud Console

**Rate Limit Handling:**

- Google Gemini free tier: ~15 requests per minute
- Workflow queue naturally limits concurrency (default: sequential processing)
- Backlog processing dynamically calculated based on rate limits
- Retry logic handles temporary rate limit errors with exponential backoff
- Batch size and interval automatically adjust to stay within free tier limits

### 8. Monitoring & Observability

**Queries to Add:**

Location: `packages/backend/convex/post_metadata.ts`

- `getPostMetadata`: Query metadata by post ID
- `getPostsWithMetadata`: Query posts with metadata joined
- `getHighConfidenceEvents`: Query events with score > threshold
- `getUpcomingEvents`: Query events with future dates
- `getProcessingStats`: Query processing status counts
- `getFailedExtractions`: Query failed extractions for retry
- `getBacklogCount`: Query count of posts without metadata

**Admin Mutations:**

- `reprocessPostMetadata`: Retry failed extraction for specific post
- `batchReprocessMetadata`: Process N posts from backlog
- `clearMetadata`: Delete metadata (for testing)
- `updateMetadataSettings`: Update AI processing settings
- `manuallyFillMetadata`: Allow admin to manually fill metadata for failed extractions

### 10. File Structure

```
packages/backend/convex/
├── schema.ts (updated: add post_metadata table, update posts table)
├── posts.ts (updated: trigger workflow on new post insert)
├── post_metadata.ts (new: queries/mutations for metadata)
├── workflows/
│   ├── workflow.ts (new: WorkflowManager setup)
│   └── postMetadata.ts (new: workflow definition)
├── ai/
│   ├── postMetadataExtractor.ts (new: AI extraction action)
│   └── telegramMessageGenerator.ts (new: message formatting mutation)
├── crons.ts (new: backlog processing cron)
└── settings.ts (updated: add AI settings)
```

## Implementation Phases

### Phase 1: Foundation

1. Create `post_metadata` table schema
2. Add `metadata_id` to `posts` table
3. Create basic queries/mutations for metadata
4. Install `@convex-dev/workflow` package

### Phase 2: Workflow Setup

1. Set up WorkflowManager component
2. Create workflow skeleton with error handling
3. Implement workflow trigger from `upsertPost`

### Phase 3: AI Integration

1. Install AI SDK 6 and `@ai-sdk/google`
2. Create Zod schema for metadata extraction
3. Implement `postMetadataExtractor` action with Google Gemini
4. Test with sample post captions

### Phase 4: Telegram Integration

1. Implement `telegramMessageGenerator` mutation
2. Update caption builder to use metadata
3. Test message formatting and length limits

### Phase 5: Backlog Processing

1. Create backlog processing cron job
2. Implement batch processing logic
3. Test gradual processing of existing posts

### Phase 6: Monitoring & Polish

1. Add monitoring queries
2. Add admin mutations for reprocessing
3. Add settings UI/management
4. Performance tuning and optimization

## Dependencies to Add

```json
{
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@convex-dev/workflow": "^0.1.0",
    "zod": "^3.23.0"
  }
}
```

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` - Required for Google Gemini API