# radio

## 0.2.4

### Patch Changes

- Fix reverb worklet loading in Cloudflare Workers deployment

  - Add build script to copy worklet bundles from `@avoid.quest/cacophony` to `public/api/worklets/` during build
  - Update build scripts to run worklet copy before Next.js build and Cloudflare deployment
  - Serve worklet bundles as static files instead of using API route with filesystem access
  - Add cache headers for worklet bundles in `public/_headers` for proper caching
  - Fix compatibility with Cloudflare Workers edge runtime which doesn't support Node.js filesystem APIs

## 0.2.3

### Patch Changes

- 6f76110: Fix type errors in audio effect parameter components

  - Fix `getDefaultValue` function type safety in biquad-filter and delay parameter components
  - Update `ParamSelect` to accept readonly option arrays
  - Add proper type guards for potentially undefined values in `param-slider`
  - Fix optional chaining for `paramFormatters.default` in `param-definitions`

## 0.2.2

### Patch Changes

- 188ef62: Fix
- Updated dependencies [188ef62]
  - @avoid.quest/cacophony@0.18.6

## 0.2.1

### Patch Changes

- ce17023: Fix Dattorro reverb effect integration and worklet loading

  **@avoid.quest/cacophony:**

  - Fix parameter access in Dattorro reverb AudioWorkletProcessor: parameters are provided as Float32Arrays (value at index 0), not AudioParam objects
  - Improve `createWorkletNode` with worklet loading cache to prevent duplicate loads and race conditions
  - Remove expected error logging when worklet isn't loaded yet (first attempt failure is expected behavior)
  - Add better error messages for actual worklet loading failures

  **radio:**

  - Add Next.js API route (`/api/worklets/[bundle]/route.ts`) to serve AudioWorklet bundles from `@avoid.quest/cacophony` package
  - Support Bun's `node_modules/.bun` structure and monorepo workspace paths for bundle resolution
  - Configure appropriate cache headers (no-cache in dev, immutable in production)
  - Fix reverb parameter initialization to set values immediately when worklet node is created
  - Update reverb parameters using `setValueAtTime` for immediate updates (k-rate parameters are read once per render quantum)
  - Remove verbose debug logging now that reverb is working correctly

- Updated dependencies [ce17023]
  - @avoid.quest/cacophony@0.18.5

## 0.2.0

### Minor Changes

- 771e165: Added reverb effect to DJ mixer with per-deck controls. The reverb uses convolution-based impulse response generation with adjustable room size (0.01-0.1), wet/dry mix, and decay time. Reverb controls are available in the FX tab for both left and right decks, with real-time parameter updates and smooth audio transitions.

## 0.1.3

### Patch Changes

- 5486a5c: feat: enhance PWA functionality and layout

  - Added InstallPrompt component to prompt users for PWA installation.
  - Updated service worker registration logic to include production checks and improved scope handling.
  - Modified service worker to skip waiting during activation and ensure immediate control over clients.
  - Updated layout metadata with additional meta tags for better PWA support.

## 0.1.1

### Patch Changes

- b08ef94: ### Infrastructure

  - Simplified and improved GitHub Actions release workflow to use path filters in the `on` section, preventing unnecessary workflow runs when no package changes are detected
  - Enhanced release automation to properly handle both PR creation (when changesets exist) and npm publishing (when versions are ahead of published versions)
  - Workflow now relies on changesets action's built-in logic for better reliability and maintainability

- Updated dependencies [b08ef94]
  - @avoid.quest/cacophony@0.18.3
