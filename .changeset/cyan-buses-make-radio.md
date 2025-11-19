---
"radio": minor
---

Migrate from Next.js to TanStack Start

- Migrated from Next.js to TanStack Start (React Router) for better Cloudflare Workers compatibility
- Removed all "use client" directives (not needed in TanStack Start)
- Replaced Next.js Image component with native img tags
- Updated build system to use Vite with TanStack Start plugin
- Migrated from OpenNext to TanStack Start for Cloudflare deployment
- Updated to Tailwind CSS v4 with new import syntax
- Updated TypeScript configuration for TanStack Start
- Updated Wrangler configuration for TanStack Start server entry
- Bumped dependencies including Convex to latest versions
