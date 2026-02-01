# RFC: Multi-Date and Date Range Support for Instarip

## Problem Statement

Currently, the system extracts only ONE event date per post. This is insufficient because:

1. **Multi-event posts**: A single post may announce multiple events
   - "GIOVEDÌ 22 ore 18:30 - evento A"
   - "GIOVEDÌ 29 ore 18:30 - evento B"

2. **Date ranges**: Events may span multiple days
   - "tutto gennaio" (all of January)
   - "dal 15 al 20 febbraio" (Feb 15-20)
   - "15-17 marzo" (Mar 15-17)

3. **Exhibition/ongoing events**: Long-running exhibitions
   - "fino al 8 marzo 2026" (until Mar 8, 2026)
   - "in mostra dal 10 gennaio al 15 aprile"

## Proposed Solution

### Schema Changes

```typescript
// posts table - ADDITIONS to existing schema
{
  // Existing field (keep for backward compatibility)
  event_date: v.optional(v.number()),
  
  // NEW: Array of all extracted event dates
  event_dates: v.optional(v.array(v.object({
    start: v.number(),           // Start timestamp (ms)
    end: v.optional(v.number()), // End timestamp (ms) - for ranges
    type: v.union(
      v.literal("single"),       // Single date: "29 gennaio"
      v.literal("range"),        // Explicit range: "15-17 marzo"
      v.literal("period"),       // Period: "tutto gennaio", "fine settimana"
      v.literal("deadline"),     // End date: "fino al 8 marzo"
    ),
    text: v.string(),            // Original matched text
  }))),
  
  // NEW: Convenience field for UI filtering
  event_period_start: v.optional(v.number()), // Earliest date
  event_period_end: v.optional(v.number()),   // Latest date
}
```

### Extraction Logic Changes

#### New Types (`types.ts`)

```typescript
export type EventDateType = "single" | "range" | "period" | "deadline";

export type ExtractedEventDate = {
  start: number;
  end?: number;
  type: EventDateType;
  text: string;
  confidence: number; // 0-100 score
};

export type ExtractionResult = {
  dates: ExtractedEventDate[];
  primaryDate: number | null;     // Best single date for backward compat
  periodStart: number | null;     // Earliest date across all
  periodEnd: number | null;       // Latest date across all
  fallback: number;               // Post timestamp as fallback
};
```

#### New Parsers Needed

1. **ITDateRangeParser** - For Italian date ranges
   - "15-17 marzo" → range Mar 15-17
   - "dal 15 al 20 febbraio" → range Feb 15-20
   - "15/03 - 17/03" → range Mar 15-17

2. **ITPeriodParser** - For Italian period expressions
   - "tutto gennaio" → period Jan 1-31
   - "fine gennaio" → period last week of Jan
   - "inizio febbraio" → period first week of Feb
   - "per tutto il mese" → period full month

3. **ITDeadlineParser** - For deadline expressions
   - "fino al 8 marzo" → deadline ending Mar 8
   - "entro il 15 febbraio" → deadline ending Feb 15
   - "until March 8" → deadline ending Mar 8

#### Extraction Algorithm

```typescript
function extractEventDates(caption: string, postTimestamp: number): ExtractionResult {
  const allDates: ExtractedEventDate[] = [];
  
  // 1. Extract with custom parsers (higher priority)
  //    - ITDateRangeParser
  //    - ITPeriodParser  
  //    - ITDeadlineParser
  //    - ITEuropeanDateParser
  //    - ITWeekendParser
  
  // 2. Extract with chrono-node (Italian + English)
  //    - Filter out duration patterns
  //    - Score results by confidence
  
  // 3. Deduplicate overlapping dates
  //    - Merge dates within 24h of each other
  //    - Prefer more specific matches
  
  // 4. Calculate summary fields
  const sorted = allDates.sort((a, b) => a.start - b.start);
  const primaryDate = selectPrimaryDate(sorted); // Best for backward compat
  const periodStart = sorted[0]?.start ?? null;
  const periodEnd = Math.max(...sorted.map(d => d.end ?? d.start));
  
  return {
    dates: sorted,
    primaryDate,
    periodStart,
    periodEnd,
    fallback: postTimestamp,
  };
}
```

### API Changes

#### Queries

```typescript
// Get posts by date range (uses new period fields)
export const getPostsInPeriod = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, { startDate, endDate }) => {
    return await ctx.db
      .query("posts")
      .withIndex("by_event_period", (q) => 
        q.gte("event_period_start", startDate)
         .lte("event_period_start", endDate)
      )
      .collect();
  },
});

// Get posts with multiple events
export const getMultiEventPosts = query({
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").collect();
    return posts.filter(p => (p.event_dates?.length ?? 0) > 1);
  },
});
```

#### Mutations

```typescript
// Backfill function updated
export const reprocessAllEventDates = action({
  // ... existing args ...
  handler: async (ctx, args) => {
    // Extract ALL dates, not just primary
    const result = extractEventDates(post.caption, post.timestamp);
    
    await ctx.runMutation(updatePostDates, {
      id: post._id,
      event_date: result.primaryDate ?? result.fallback,
      event_dates: result.dates,
      event_period_start: result.periodStart,
      event_period_end: result.periodEnd,
    });
  },
});
```

### Migration Strategy

1. **Phase 1: Add new fields** (non-breaking)
   - Add `event_dates`, `event_period_start`, `event_period_end` to schema
   - Keep existing `event_date` field
   - Deploy schema changes

2. **Phase 2: Implement new parsers**
   - Create ITDateRangeParser
   - Create ITPeriodParser
   - Create ITDeadlineParser
   - Write comprehensive tests

3. **Phase 3: Update extraction logic**
   - Modify extractEventDate to return multiple dates
   - Update backfill function
   - Run backfill on all existing posts

4. **Phase 4: Update UI** (optional)
   - Display all event dates in post detail view
   - Filter by date range in list view

### Test Cases

```typescript
describe("Multi-date extraction", () => {
  it("extracts multiple single dates", () => {
    const caption = "GIOVEDÌ 22 alle 18:30\nGIOVEDÌ 29 alle 18:30";
    const result = extractEventDates(caption, REF_TIMESTAMP);
    expect(result.dates).toHaveLength(2);
    expect(result.dates[0].start).toBe(/* Jan 22 */);
    expect(result.dates[1].start).toBe(/* Jan 29 */);
  });

  it("extracts date range", () => {
    const caption = "Festival dal 15 al 17 marzo";
    const result = extractEventDates(caption, REF_TIMESTAMP);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].type).toBe("range");
    expect(result.dates[0].start).toBe(/* Mar 15 */);
    expect(result.dates[0].end).toBe(/* Mar 17 */);
  });

  it("extracts period", () => {
    const caption = "Eventi tutto gennaio";
    const result = extractEventDates(caption, REF_TIMESTAMP);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].type).toBe("period");
    expect(result.dates[0].start).toBe(/* Jan 1 */);
    expect(result.dates[0].end).toBe(/* Jan 31 */);
  });

  it("extracts deadline", () => {
    const caption = "In mostra fino al 8 marzo 2026";
    const result = extractEventDates(caption, REF_TIMESTAMP);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].type).toBe("deadline");
    expect(result.dates[0].end).toBe(/* Mar 8 */);
  });
});
```

### Timeline Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| 1 | 30 min | Schema changes + deploy |
| 2 | 2-3 hours | New parsers + tests |
| 3 | 1 hour | Extraction logic + backfill |
| 4 | Optional | UI updates |

### Open Questions

1. **Conflicting dates**: How to handle when multiple dates are found but some seem like errors?
   - Proposal: Use confidence scoring, filter low-confidence matches

2. **Performance**: Will storing arrays of dates impact query performance?
   - Proposal: Add dedicated indexes on period_start/period_end

3. **UI complexity**: How should multiple dates be displayed?
   - Proposal: Show primary date in list, all dates in detail view

---

## Approval

- [ ] Schema design approved
- [ ] Parser list approved
- [ ] Migration strategy approved
- [ ] Ready to implement
