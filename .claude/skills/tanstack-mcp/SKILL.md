# TanStack MCP Skill

Guide for using the TanStack MCP server to access up-to-date documentation and create projects.

## When to Use

- Need current TanStack Router/Start/Query/Table/Form docs
- Creating new TanStack Start projects with add-ons
- Searching for specific API usage or examples
- Exploring ecosystem partners

## Available MCP Tools

### Documentation Tools

| Tool | Description |
|------|-------------|
| `tanstack_search_docs` | Search documentation via Algolia |
| `tanstack_doc` | Fetch a specific doc page by library and path |
| `tanstack_list_libraries` | List all TanStack libraries with metadata |
| `tanstack_ecosystem` | Browse ecosystem partners by category or library |

### Project Creation Tools

| Tool | Description |
|------|-------------|
| `listTanStackAddOns` | Get available add-ons for project creation |
| `createTanStackApplication` | Create a new TanStack Start project |

## How to Invoke

When you need TanStack documentation, use the MCP tools directly:

```
// Search for loader docs
Use tanstack_search_docs to find "loaders in TanStack Router"

// Get specific page
Use tanstack_doc for library "router" path "guide/data-loading"

// List available add-ons
Use listTanStackAddOns to see what's available for a new project
```

## Example Prompts

**For documentation:**
- "How do I use loaders in TanStack Router?"
- "Search TanStack docs for server functions"
- "What's the API for createFileRoute?"

**For project creation:**
- "Create a TanStack Start project called 'my-app' with Clerk auth and Drizzle ORM"
- "What add-ons are available for TanStack Start?"

## Libraries Covered

- **TanStack Start** — Full-stack React framework
- **TanStack Router** — Type-safe routing
- **TanStack Query** — Data fetching & caching
- **TanStack Table** — Headless table UI
- **TanStack Form** — Form state management
- **TanStack Store** — Framework-agnostic state
- **TanStack Virtual** — Virtualized lists

## Auto-Invoke Rule

Add this to your CLAUDE.md or project rules:

```
When working with TanStack libraries (Router, Start, Query, Table, Form, Store, Virtual),
always use the TanStack MCP tools to fetch current documentation before writing code.
```

## Cloudflare Workers Deployment (TanStack Start)

Current recommended setup for Cloudflare Workers:

```typescript
// vite.config.ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
  ],
});
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "app-name",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": ".output/server/index.mjs",
  "assets": {
    "directory": "./.output/public/",
    "binding": "ASSETS"
  }
}
```

## Notes

- MCP provides **live, up-to-date** docs — always prefer it over training data
- For version-specific docs, mention the version in your query
- The radio app in this repo is the reference implementation for TanStack Start + Cloudflare
