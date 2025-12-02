---
"@avoid.quest/cacophony": minor
"radio": minor
"@avoid.quest/radio-shared": patch
"@avoid.quest/radio-audio": patch
"@avoid.quest/soundcloud": patch
"@avoid.quest/bandcamp": patch
"@workspace/backend": patch
"@workspace/scraper": patch
---

## Monorepo Refactoring & New Packages

### New Packages

- **`@avoid.quest/radio-shared`** - New shared types package for radio platform metadata, Radio types, and platform item responses
- **`@avoid.quest/radio-audio`** - New audio package extracted from `apps/radio`, containing:
  - AudioManager and audio state management
  - Complete effects system (registry, types, effect manager)
  - React hooks: `useAudio`, `useDjAudio`, `useSingleAudio`
  - Filter types and configurations
- **`@avoid.quest/soundcloud`** - New SoundCloud platform integration package with:
  - URL detection and item type detection
  - SoundCloud API client with client ID fetching
  - Track and playlist resolution with stream URL extraction
- **`@avoid.quest/bandcamp`** - New Bandcamp platform integration package with:
  - URL detection and item type detection (album, track, artist, label)
  - HTML parsing and metadata extraction
  - Album and track resolution with stream URL extraction

### Audio System Improvements

- **Added Universal Dry/Wet Controls** - All effects now support unified dry/wet mixing via `UniversalParams` component
- **Refactored Effect Parameters** - Standardized effect parameter UI across all effect types
- **Improved Type Safety** - Better type exports and re-exports for audio nodes and effects

### Type System Enhancements

- **Cacophony Type Improvements** - Added proper `BiquadFilterNode`, `AudioNode` type exports
- **Centralized Type Definitions** - Moved shared types to `@avoid.quest/radio-shared` for better reusability
- **Better Type Compatibility** - Fixed type compatibility issues between cacophony and Web Audio API types

### Dependency Updates

- **Convex** - Updated to `^1.30.0` across backend and scraper packages
- **Workflow** - Updated `@convex-dev/workflow` to `^0.3.3`
- **AI SDK** - Updated `ai` package to `^5.0.106`
- **Cloudflare Types** - Updated `@cloudflare/workers-types` to `^4.20251202.0`
- **OpenNext** - Updated `@opennextjs/cloudflare` to `^1.14.1`

### Infrastructure Changes

- **Renamed Scripts** - Standardized `check-types` → `typecheck` across all packages
- **Turbo Tasks** - Added `preview` task to turbo.json pipeline
- **Biome Config** - Updated to exclude generated Convex server files from linting
- **TypeScript Configs** - Added proper tsconfig.json files for new packages

### Code Quality

- **Import Consolidation** - Moved all audio-related imports to use `@avoid.quest/radio-audio`
- **Platform Abstraction** - Extracted platform-specific logic (SoundCloud, Bandcamp) into dedicated packages
- **Better Separation of Concerns** - Clear boundaries between shared types, audio system, and platform integrations
