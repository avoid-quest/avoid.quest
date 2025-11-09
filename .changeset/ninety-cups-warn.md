---
"@avoid.quest/cacophony": patch
---

### Added

- **Phase Vocoder Processor**: New AudioWorklet processor for real-time pitch shifting without tempo change

  - Implements phase vocoder algorithm using FFT-based spectral processing
  - Supports configurable `pitchFactor` parameter for pitch adjustment
  - Uses Overlap-Add (OLA) processing for smooth audio output
  - Bundled as `phase-vocoder-bundle.js` for AudioWorklet usage

- **Worklet Loading Infrastructure**: Enhanced worklet management system
  - Added `loadWorklets()` method to Cacophony class for preloading worklets
  - Improved `createWorkletNode()` with worklet loading cache to prevent duplicate loads
  - Added race condition handling for concurrent worklet load requests
  - Better error messages for worklet loading failures

### Changed

- **Worklet Loading**: `createWorkletNode()` now tracks loaded worklets to avoid redundant module loads
  - Worklets are cached after first successful load
  - Concurrent load requests are deduplicated to prevent race conditions
  - Removed verbose error logging for expected first-attempt failures (worklet not loaded yet)

### Technical Details

- Phase vocoder uses 2048-sample block size with Hann windowing
- Implements peak detection and phase-preserving frequency shifting
- Supports AbortSignal for cancellation during worklet loading
- Worklet bundle includes FFT.js library for efficient frequency domain processing
