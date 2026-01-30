# Convex Expert Skill

Expert guidance for writing Convex backend code following official best practices and project-specific patterns.

## When to Use

- Writing Convex queries, mutations, actions
- Designing schemas and indexes
- Working with components (isolated namespaces)
- Pagination, file storage, cron jobs
- Full-text search

## Rules

**Always read `references/convex_rules.txt` before writing Convex code.** It contains the official, up-to-date guidelines.

## Project-Specific Patterns

### Component Architecture

This project uses **Convex local components** for isolation:

```
packages/backend/convex/
├── components/
│   ├── instarip/          # Instagram data component (isolated namespace)
│   │   ├── posts.ts
│   │   ├── users.ts
│   │   ├── mediaItems.ts
│   │   ├── settings.ts
│   │   ├── fetcher.ts
│   │   └── schema.ts      # Component's own schema
│   └── telegram/          # Telegram sender component
├── instarip/              # App-specific bot logic (uses components)
├── crons.ts               # Orchestration (calls component functions)
├── http.ts                # HTTP routes
└── schema.ts              # Main app schema (minimal)
```

### Accessing Component Functions

```typescript
// From main app code (crons.ts, http.ts, etc.)
import { components } from "./_generated/api";

// Query component
await ctx.runQuery(components.instarip.posts.getPostById, { id });

// Mutation component
await ctx.runMutation(components.instarip.posts.upsertPost, { ... });

// Action component  
await ctx.runAction(components.telegram.sender.sendMessage, { ... });
```

### Timestamp Convention

**All timestamps are in MILLISECONDS (UTC)**:
- Use `Date.now()` for current time
- Store as `v.number()` 
- Field naming: `timestamp`, `sentAt`, `*_at` (e.g., `last_scraped_at`)

```typescript
// ✅ Correct
await ctx.db.patch(id, { sentAt: Date.now() });

// ❌ Wrong (seconds)
await ctx.db.patch(id, { sentAt: Math.floor(Date.now() / 1000) });
```

### Status State Machine

Posts use a state machine for sending lifecycle:

```typescript
status: v.union(
  v.literal("pending"),   // Ready to send
  v.literal("sending"),   // Currently being sent (locked)
  v.literal("sent"),      // Successfully sent
  v.literal("failed"),    // Permanently failed
)
```

Transitions:
- `pending → sending` (claim for sending)
- `sending → sent` (success)
- `sending → pending` (retry on failure)
- `pending/sending → failed` (max retries exceeded)

### Index Naming

Always include all fields in the index name:

```typescript
// ✅ Correct
.index("by_status", ["status"])
.index("by_to_be_scraped_last_scraped_at", ["to_be_scraped", "last_scraped_at"])

// ❌ Wrong
.index("status_index", ["status"])
```

### Validators with Return Types

Always specify `returns` validator:

```typescript
export const getPostById = query({
  args: { id: v.id("posts") },
  returns: v.union(v.object({ ... }), v.null()),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});
```

### Pagination Pattern

```typescript
import { paginationOptsValidator } from "convex/server";

export const getPostsPaginated = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(postValidator),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("posts")
      .withIndex("by_event_date")
      .order("desc")
      .paginate(paginationOpts);
  },
});
```

## Quick Reference

| Pattern | Example |
|---------|---------|
| Query | `query({ args: {}, returns: v.null(), handler: async (ctx, args) => {} })` |
| Mutation | `mutation({ args: {}, returns: v.null(), handler: async (ctx, args) => {} })` |
| Action | `action({ args: {}, returns: v.null(), handler: async (ctx, args) => {} })` |
| Internal | `internalQuery`, `internalMutation`, `internalAction` |
| Component call | `ctx.runQuery(components.name.file.fn, args)` |
| Get by ID | `await ctx.db.get(id)` |
| Insert | `await ctx.db.insert("table", data)` |
| Patch | `await ctx.db.patch(id, updates)` |
| Delete | `await ctx.db.delete(id)` |

## Files

- `references/convex_rules.txt` — Official Convex coding rules (read this first)
