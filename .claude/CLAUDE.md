# avoid.quest

## Project Overview

**avoid.quest** - Turbo monorepo with Bun, Convex backend, TanStack Start frontend deployed on Cloudflare Workers.

Apps: **instarip** (Instagram viewer), **radio** (PWA radio player), **web** (landing page)

## Commands

```bash
bun install                    # Install all dependencies
bun run dev                    # Start all apps + Convex backend
bun run check                  # Lint + type check (Ultracite/Biome)
bun run fix                    # Auto-fix linting issues
bun run test                   # Run all tests
bun run build                  # Build all apps
bun run cf-deploy              # Deploy to Cloudflare Workers
bun run deploy:backend         # Deploy Convex backend
bun run ui add button          # Install shadcn components
```

## Shared Packages

- **`@avoid.quest/ui`** - Design system (shadcn/ui + Tailwind v4). Always use instead of custom components.
- **`@avoid.quest/shared`** - Utilities (date formatting, error handling, logging). Import, don't recreate.

## Types

- Prefer inferred types
- Never use `any`
- Never cast with `as`
- Import existing types, don't recreate

## Documentation

Use MCP servers for up-to-date docs instead of training data:
- **TanStack MCP** — Router, Query, Start, Table, Form, Virtual, Store
- **Context7 MCP** — Any other library (React, Tailwind, Zod, Drizzle, etc.)

### Auto-Invoke Rules

When working with these libraries, **always use MCP tools first**:

1. **TanStack libraries** → Use `tanstack_search_docs` or `tanstack_doc` 
2. **Other libraries** → Add `use context7` to your query or use `get-library-docs`
3. **Convex code** → Read `.claude/skills/convex-expert/SKILL.md` first

### Skills

Located in `.claude/skills/`:
- **convex-expert** — Convex coding rules + project-specific patterns
- **tanstack-mcp** — TanStack MCP tool reference
- **context7-mcp** — Context7 MCP tool reference

## Code Style

- `for...of` over `.forEach()`
- `async/await` over promise chains
- Early returns to reduce nesting
- No `console.log` in production
