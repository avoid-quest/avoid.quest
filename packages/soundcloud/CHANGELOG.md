# @avoid.quest/soundcloud

## 0.0.1

### Patch Changes

- a90a800: ## Monorepo Refactoring & New Packages

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

  ### Bug Fixes

  - **Fixed Group Volume Calculation** - Fixed division by zero bug when sounds array is empty in Group class
  - **Fixed Audio Player Volume Calculation** - Fixed operator precedence bug in volume calculation (`value[0] ?? 0 / MAX_VOLUME` → `(value[0] ?? 0) / MAX_VOLUME`)
  - **Improved Single Player Mute/Volume Logic** - Enhanced mute handling to automatically unmute when volume is adjusted above zero

  ### UI/UX Improvements

  - **Effect Picker Styling** - Updated max height from `max-h-[32rem]` to standard Tailwind class `max-h-128`
  - **Simplified Tab Labels** - Changed "External Inputs" tab label to "External" for better brevity
  - **Component Cleanup** - Removed unused `artist` prop from PlaylistView component

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
  - **Parameter Formatters** - Added `linearGain` formatter for proper dB display with -∞ dB handling for zero values
  - **Code Cleanup** - Removed unused constants (`_SESSION_MAX_AGE`) and variables (`_debugLogged`)
  - **Type Improvements** - Removed unnecessary `@ts-expect-error` suppressions after fixing type compatibility issues
  - **Code Formatting** - Improved formatting consistency in audio processor files (phase-vocoder, dattorro-reverb)

- Updated dependencies [a90a800]
  - @avoid.quest/radio-shared@0.0.1
