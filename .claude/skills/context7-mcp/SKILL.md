# Context7 MCP Skill

Guide for using Context7 MCP to fetch up-to-date documentation for any library.

## When to Use

- Need current docs for ANY library (not just TanStack)
- Working with fast-moving frameworks (Next.js, React, Tailwind, Zod, etc.)
- Want to avoid hallucinated APIs from outdated training data
- Need version-specific documentation

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `resolve-library-id` | Resolves a library name to a Context7-compatible ID |
| `get-library-docs` | Retrieves documentation for a library using its Context7 ID |

## How to Invoke

Simply add `use context7` to your prompt, or specify a library directly:

```
// Auto-resolve library
Create a Next.js middleware that checks for JWT in cookies. use context7

// Specify exact library
Implement Supabase auth. use library /supabase/supabase for API and docs.

// Version-specific
How do I set up Next.js 14 middleware? use context7
```

## Library ID Syntax

Use `/org/repo` format for exact matches:

| Library | Context7 ID |
|---------|-------------|
| Next.js | `/vercel/next.js` |
| React | `/facebook/react` |
| Tailwind CSS | `/tailwindlabs/tailwindcss` |
| Zod | `/colinhacks/zod` |
| Drizzle ORM | `/drizzle-team/drizzle-orm` |
| Convex | `/get-convex/convex` |
| Supabase | `/supabase/supabase` |

## Example Prompts

```
Configure Tailwind CSS v4 with Vite. use context7

Set up Drizzle ORM with PostgreSQL. use library /drizzle-team/drizzle-orm

Create a Zod schema for user validation. use context7

Implement React 19 Server Components. use context7
```

## Auto-Invoke Rule

Add this to your CLAUDE.md or project rules:

```
When writing code that uses external libraries, use Context7 MCP to fetch 
up-to-date documentation instead of relying on training data.
Especially for: React, Next.js, Tailwind, Zod, Drizzle, and any actively developed library.
```

## When NOT to Use

- For TanStack libraries — use TanStack MCP instead (more specialized)
- For Convex — use convex-expert skill (has project-specific patterns)
- For stable, rarely-changing libraries where training data is sufficient

## Notes

- Context7 fetches docs from official sources in real-time
- Reduces hallucinated APIs significantly
- Works with 1000+ libraries
- Free tier available at context7.com
