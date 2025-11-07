<!-- e3bfe01d-b2b4-473a-a3dc-d84b3dce81f0 6e003d95-49e9-4c39-8e45-265648b1d7d4 -->
# AI Post Metadata Extraction System - Refined Plan

## Overview

Implement an AI-driven metadata extraction system that automatically processes Instagram posts to extract event-related information. The system uses **Convex Agents** for structured AI extraction with audit trails, **Convex Workflows** for durable orchestration, Google Gemini (free tier) for AI extraction, and stores results in a dedicated `post_metadata` table. All posts (new and existing) will be processed, with new posts queued immediately and existing posts processed gradually.

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
- `agent_thread_id`: Optional string - Reference to Convex Agent thread for audit trail

**Indexes:**

- `by_post_id` - Unique index on `post_id` for fast lookups
- `by_event_score` - Index on `event_score` for filtering high-confidence events
- `by_event_date_start` - Index on `event_date_start` for date-based queries
- `by_processing_status` - Index on `processing_status` for monitoring/queue management
- `by_event_type` - Index on `event_type` for category filtering

#### Update `posts` Table:

- Add `metadata_id`: Optional Id<"post_metadata"> - Reference to extracted metadata
- Allows easy joining while keeping metadata separate

### 2. Convex Agent Component Setup

#### Agent Component Installation

Location: `packages/backend/convex/`

**Installation:**

- Add `@convex-dev/agent` dependency
- Register agent component in Convex dashboard (via `npx convex dev` or dashboard UI)
- Component provides thread/message management tables automatically (we won't use threads, but component is required)

#### Agent: `postMetadataExtractorAgent`

Location: `packages/backend/convex/ai/postMetadataExtractorAgent.ts`

**Implementation Details:**

- Uses `Agent` class from `@convex-dev/agent`
- Google Gemini provider via AI SDK 6 (`@ai-sdk/google`)
- Model: `gemini-2.5-flash` (fast, free tier compatible)
- Configured with system instructions for event extraction
- Exposes `asObjectAction()` for structured output matching `post_metadata` fields
- **No thread management** - one-shot extraction without conversation history

**Agent Configuration:**

- System instructions: Defines event extraction task, output format, examples. Includes definition of what constitutes an "event" (gatherings, performances, workshops, meetups, concerts, conferences, festivals, exhibitions, etc.)
- Date/time parsing: Assume Rome/Italy timezone (UTC+1/UTC+2) for event dates unless explicitly stated otherwise
- Event score: AI determines confidence percentage (0-100) that the post describes an event

**Structured Output Schema:**

- Uses Zod schema matching `post_metadata` fields
- All fields properly typed with optional fields and enums for `event_type`
- Schema passed to `asObjectAction()` for type-safe extraction

**Benefits of Using Agents (without threads):**

- Better workflow integration (can call agent actions from workflow steps)
- Structured output via `asObjectAction()` with type safety
- Built-in retry and error handling capabilities
- Consistent with Convex best practices for AI operations
- Cleaner abstraction than direct AI SDK calls in workflows

### 3. Convex Workflow Implementation

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

1. Create or get metadata record (mark as "processing")
2. Create agent thread for this post extraction (for audit trail)
3. Load post data via internal query
4. Extract metadata via agent's `asObjectAction()` (with retry)
5. Generate Telegram message via AI SDK action (direct call, no thread needed)
6. Save metadata and link to post
7. Update thread metadata with extraction status

**Workflow Features:**

- Durable execution (survives restarts)
- Automatic retry on transient failures (3 attempts, exponential backoff)
- Rate limiting via workflow queue (processes sequentially by default)
- Idempotency check (skip if metadata already exists)
- Error handling with status tracking
- Thread-based audit trail for each extraction

**Workflow Triggering:**

- **New Posts**: Triggered from `upsertPost` mutation when new post inserted
- **Existing Posts**: Triggered by scheduled cron job that processes backlog gradually

### 4. Telegram Message Generation

#### Function: `generateTelegramMessage`

Location: `packages/backend/convex/ai/telegramMessageGenerator.ts`

**Implementation:**

- Uses AI SDK 6 directly (not agents - simpler for one-shot generation)
- Google Gemini provider (`@ai-sdk/google`)
- Model: `gemini-2.5-flash`
- Takes extracted metadata and post URL
- Generates caption text only (media handled separately by post-sender)
- **Message format**: Text content (max 1024 chars) that fits within Telegram limits, ending with Instagram link
- Uses Telegram HTML formatting (`<b>`, `<i>`, `<a>`) for formatting
- Smart truncation that preserves sentence/word boundaries
- Escapes HTML entities properly

**Why Not Use Agents Here:**

- One-shot generation (no conversation needed)
- No audit trail requirement (metadata extraction already has thread)
- Simpler implementation for straightforward text generation

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
- `getExtractionThread`: Query agent thread messages for a post (for debugging)

**Admin Mutations:**

- `reprocessPostMetadata`: Retry failed extraction for specific post
- `batchReprocessMetadata`: Process N posts from backlog
- `clearMetadata`: Delete metadata (for testing)
- `updateMetadataSettings`: Update AI processing settings
- `manuallyFillMetadata`: Allow admin to manually fill metadata for failed extractions

### 9. File Structure

```
packages/backend/convex/
├── schema.ts (updated: add post_metadata table, update posts table)
├── posts.ts (updated: trigger workflow on new post insert)
├── post_metadata.ts (new: queries/mutations for metadata)
├── workflows/
│   ├── workflow.ts (new: WorkflowManager setup)
│   └── postMetadata.ts (new: workflow definition)
├── ai/
│   ├── postMetadataExtractorAgent.ts (new: Agent setup with asObjectAction)
│   └── telegramMessageGenerator.ts (new: direct AI SDK message formatting action)
├── crons.ts (new: backlog processing cron)
└── settings.ts (updated: add AI settings)
```

## Implementation Phases

### Phase 1: Foundation

1. Create `post_metadata` table schema
2. Add `metadata_id` to `posts` table
3. Create basic queries/mutations for metadata
4. Install `@convex-dev/agent` and `@convex-dev/workflow` packages
5. Register agent and workflow components in Convex dashboard

### Phase 2: Agent Setup

1. Set up Agent component (register in dashboard)
2. Create `postMetadataExtractorAgent` with Google Gemini
3. Define Zod schema for structured output
4. Expose `asObjectAction()` for metadata extraction
5. Test with sample post captions

### Phase 3: Workflow Setup

1. Set up WorkflowManager component
2. Create workflow skeleton with error handling
3. Integrate agent action into workflow
4. Implement workflow trigger from `upsertPost`
5. Test workflow execution and retry logic

### Phase 4: Telegram Integration

1. Implement `telegramMessageGenerator` action (direct AI SDK)
2. Update caption builder to use metadata
3. Test message formatting and length limits
4. Verify HTML formatting and link handling

### Phase 5: Backlog Processing

1. Create backlog processing cron job
2. Implement batch processing logic
3. Test gradual processing of existing posts
4. Verify rate limit compliance

### Phase 6: Monitoring & Polish

1. Add monitoring queries
2. Add admin mutations for reprocessing
3. Add settings UI/management
4. Performance tuning and optimization
5. Add thread-based debugging queries

## Dependencies to Add

```json
{
  "dependencies": {
    "ai": "^5.0.89",
    "@ai-sdk/google": "^2.0.29",
    "@convex-dev/agent": "^0.2.12",
    "@convex-dev/workflow": "^0.2.7",
    "zod": "^4.1.12"
  }
}
```

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` - Required for Google Gemini API

## Key Changes from Original Plan

1. **Convex Agents Integration**: Use `Agent` class with `asObjectAction()` for structured extraction instead of direct AI SDK `generateObject`. This provides:

   - Automatic message persistence (audit trail)
   - Better workflow integration
   - Thread-based debugging capabilities

2. **Hybrid Approach**: Use agents for extraction (needs audit trail), direct AI SDK for Telegram message generation (simpler, no thread needed)

3. **Thread Management**: One agent thread per post extraction for audit trail and debugging

4. **Workflow Integration**: Agent actions called from workflow steps with proper retry handling

### To-dos

- [ ] Create post_metadata table schema with all fields and indexes, update posts table with metadata_id
- [ ] Install @convex-dev/agent, register agent component in Convex dashboard, set up basic agent infrastructure
- [ ] Create postMetadataExtractorAgent with Google Gemini, define Zod schema, expose asObjectAction()
- [ ] Install @convex-dev/workflow, set up WorkflowManager, create workflow skeleton
- [ ] Implement processPostMetadata workflow with agent integration, thread creation, and error handling
- [ ] Implement telegramMessageGenerator action using direct AI SDK (not agents) for message formatting
- [ ] Update upsertPost mutation to trigger workflow on new posts and caption updates
- [ ] Create backlog processing cron job with rate limit handling
- [ ] Update Telegram caption builder to use metadata.telegram_message when available
- [ ] Add monitoring queries and admin mutations for metadata management