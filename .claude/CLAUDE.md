# avoid.quest

## Project Overview

**avoid.quest** - Turbo monorepo with Bun, Convex backend, multiple TanStack Start apps deployed on Cloudflare Workers.

## Commands

```bash
bun install                    # Install all dependencies
bun run dev                    # Start all apps + Convex backend
bun run check                  # Check lints (Ultracite/Biome)
bun run fix                    # Auto-fix linting issues
bun run typecheck              # Run typechecks
bun run test                   # Run all tests
bun run build                  # Build all apps
bun run cf-deploy              # Deploy to Cloudflare Workers
bun run deploy:backend         # Deploy Convex backend
bun run ui add button          # Install shadcn components
```

## Types

- Prefer inferred types
- Never use `any`
- Never cast with `as`
- Import existing types, don't recreate

## Documentation

Use MCP servers for up-to-date docs instead of training data:
- **Context7 MCP** — Any other library (React, Tailwind, Zod, etc.)

## Code Style

- `for...of` over `.forEach()`
- `async/await` over promise chains
- Early returns to reduce nesting
- No `console.log` in production
