---
"@avoid.quest/cacophony": patch
---

### Patch Changes

- Fix Dattorro reverb effect integration and worklet loading

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

- and more...
