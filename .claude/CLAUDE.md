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

- **`@workspace/ui`** - Design system (shadcn/ui + Tailwind v4). Always use instead of custom components.
- **`@workspace/shared`** - Utilities (date formatting, error handling, logging). Import, don't recreate.

## Types

- Prefer inferred types
- Never use `any`
- Never cast with `as`
- Import existing types, don't recreate

## Documentation

Use MCP servers for up-to-date docs instead of training data:
- **TanStack MCP** - Router, Query, Start, Table, Form
- **Context7** - Convex, Bun, React, any library

## Code Style

- `for...of` over `.forEach()`
- `async/await` over promise chains
- Early returns to reduce nesting
- No `console.log` in production
