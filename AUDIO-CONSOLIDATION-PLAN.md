# Radio App Consolidation Plan

> **Status**: Planning phase - to be written to `docs/AUDIO-CONSOLIDATION-PLAN.md` and committed

## Goal
Consolidate audio architecture into `apps/radio` with openDAW lib-dsp as the **DSP core** for all audio processing, plus a thin playback layer for streaming mp3 from icecast endpoints.

---

## Key Insight

**openDAW lib-dsp provides DSP algorithms, NOT playback infrastructure.**

| Layer | Responsibility | Solution |
|-------|---------------|----------|
| Playback/Streaming | Audio context, fetch/decode, worklet management | Simplified layer from cacophony learnings |
| DSP Processing | Effects, synthesis, analysis, routing | **openDAW lib-dsp** (the CORE) |

---

## Architecture Change

### Current (3-layer, complex)
```
apps/radio → packages/radio-audio → packages/cacophony → @opendaw/lib-dsp
```

### Target (Self-contained, openDAW-centric)
```
apps/radio/src/lib/audio/
├── playback/                    # Thin playback infrastructure
│   ├── audio-context.ts         # Context singleton + resume handling
│   ├── stream-source.ts         # Icecast mp3 streaming (fetch/decode)
│   ├── worklet-manager.ts       # AudioWorklet lifecycle
│   └── types.ts                 # Radio, AudioState types
│
├── dsp/                         # openDAW-powered DSP (THE CORE)
│   ├── processor.ts             # Main AudioWorklet processor
│   ├── effects/                 # All effects using openDAW primitives
│   │   ├── index.ts             # Effect factory
│   │   ├── crusher.ts           # openDAW Crusher
│   │   ├── delay.ts             # openDAW Delay
│   │   ├── biquad.ts            # openDAW BiquadMono/Stack
│   │   ├── limiter.ts           # openDAW SimpleLimiter
│   │   ├── reverb.ts            # Custom (Dattorro/FreeVerb)
│   │   ├── compressor.ts        # openDAW CTAGDRC
│   │   └── ...
│   ├── synthesis/               # openDAW synthesis (future)
│   │   ├── oscillator.ts        # BandLimitedOscillator
│   │   ├── envelope.ts          # ADSR
│   │   └── lfo.ts               # LFO modulation
│   ├── analysis/                # openDAW analysis
│   │   ├── fft.ts               # FFT for spectrum
│   │   ├── rms.ts               # RMS metering
│   │   └── peak.ts              # Peak detection
│   └── routing/                 # openDAW Graph for signal routing
│       └── graph.ts             # TopologicalSort for effect chains
│
├── manager/                     # High-level API
│   ├── audio-manager.ts         # Simplified singleton (~400 lines)
│   └── crossfade.ts             # Crossfade utilities
│
├── hooks/                       # React integration
│   ├── use-audio.ts
│   ├── use-single-audio.ts
│   └── use-dj-audio.ts
│
└── index.ts                     # Public exports
```

---

## openDAW as DSP Core

### Effects (using openDAW primitives)
| Effect | openDAW Component | Status |
|--------|-------------------|--------|
| crusher | `Crusher` | ✅ Direct |
| delay | `Delay` | ✅ Direct |
| biquadFilter | `BiquadCoeff`, `BiquadMono`, `BiquadStack` | ✅ Direct |
| revamp (7-band EQ) | `BiquadCoeff/Stack` | ✅ Direct |
| fold | `wavefold`, `ResamplerStereo` | ✅ Direct |
| stereoTool | `Ramp`, `StereoMatrix` | ✅ Direct |
| tidal | `TidalComputer`, `Smooth` | ✅ Direct |
| limiter | `SimpleLimiter` | 🆕 Add |
| compressor | `@opendaw/lib-dsp/ctagdrc` | ⬆️ Upgrade |

### Custom (keep from cacophony learnings)
| Effect | Notes |
|--------|-------|
| plateReverb | Dattorro algorithm - no openDAW equivalent |
| standardReverb | FreeVerb port - no openDAW equivalent |
| phaseVocoder | FFT pitch shift - could use openDAW FFT |
| distortion | Wave shaper - keep custom |

### Analysis & Metering (ADD from openDAW)
| Feature | openDAW Component | Use Case |
|---------|-------------------|----------|
| Spectrum analyzer | `FFT` | Visualizations |
| Level metering | `RMS` | VU meters |
| Peak detection | Peak utilities | Clipping indicators |

### Synthesis (future, from openDAW)
| Feature | openDAW Component | Use Case |
|---------|-------------------|----------|
| Test tones | `BandLimitedOscillator` | Debugging |
| Envelopes | `Adsr` | Ducking effects |
| Modulation | `LFO` | Tremolo/vibrato |

### Signal Routing (from openDAW)
| Feature | openDAW Component | Use Case |
|---------|-------------------|----------|
| Effect chain ordering | `Graph`, `TopologicalSort` | Dynamic routing |

---

## Implementation Phases

### Phase 1: Playback Infrastructure
Create the thin playback layer (from cacophony learnings):

```
apps/radio/src/lib/audio/playback/
├── audio-context.ts      # Singleton, resume handling, mobile fixes
├── stream-source.ts      # Icecast mp3: fetch → decode → buffer
├── worklet-manager.ts    # AudioWorklet lifecycle
└── types.ts              # Radio, AudioState, AudioError
```

**Key simplifications from cacophony:**
- Remove cache system (streaming only)
- Remove buffer/oscillator source types (streaming only)
- Remove 3D audio positioning
- Keep: context management, streaming, worklet orchestration

### Phase 2: openDAW DSP Core
Build the DSP layer entirely on openDAW primitives:

```
apps/radio/src/lib/audio/dsp/
├── processor.ts          # AudioWorklet processor
├── effects/              # openDAW-based effects
├── analysis/             # FFT, RMS, Peak (from openDAW)
└── routing/              # Graph-based effect chain
```

**Effect migration:**
1. Crusher → `@opendaw/lib-dsp Crusher` (already done)
2. Delay → `@opendaw/lib-dsp Delay`
3. Biquad → `@opendaw/lib-dsp BiquadMono/Stack`
4. Compressor → `@opendaw/lib-dsp/ctagdrc` (upgrade)
5. Limiter → `@opendaw/lib-dsp SimpleLimiter` (new)
6. Reverbs → Keep custom Dattorro/FreeVerb (no openDAW equivalent)
7. PhaseVocoder → Keep custom, use openDAW `FFT`
8. Distortion → Keep custom wave shaper

**New analysis features:**
- Spectrum: `FFT` for visualizations
- Metering: `RMS` for VU meters
- Peak: Level detection

**Routing:**
- Use openDAW `Graph` + `TopologicalSort` for effect chain ordering

### Phase 3: High-Level Manager
Simplified AudioManager API (~400 lines vs 1306):

```
apps/radio/src/lib/audio/manager/
├── audio-manager.ts      # Sound lifecycle, state subscriptions
└── crossfade.ts          # Smooth transitions
```

**API surface to maintain:**
```typescript
class AudioManager {
  static getInstance(): AudioManager;
  createSound(radio: Radio, soundId?: string): Promise<Sound>;
  playSound(soundId: string, volume?: number): Promise<void>;
  pauseSound(soundId: string): void;
  stopSound(soundId: string): void;
  cleanupSound(soundId: string): Promise<void>;
  setVolume(soundId: string, volume: number): void;
  crossfade(from: string, to: string, duration: number): Promise<void>;
  addEffect(soundId: string, config: EffectConfig): void;
  updateEffect(soundId: string, effectId: string, config: Partial<EffectConfig>): Promise<void>;
  removeEffect(soundId: string, effectId: string): void;
  reorderEffects(soundId: string, effectIds: string[]): void;
  updateFilter(soundId: string, config: FilterConfig): void;
  subscribe(soundId: string, callback: (state: AudioState) => void): () => void;
}
```

### Phase 4: React Hooks
Port from radio-audio with minimal changes:

```
apps/radio/src/lib/audio/hooks/
├── use-audio.ts          # Basic playback
├── use-single-audio.ts   # With crossfading
└── use-dj-audio.ts       # Dual deck + effects
```

Hooks stay ~identical - they just wrap AudioManager.

### Phase 5: Update All Imports
Change imports across ~40 files:

```typescript
// Before
import { useAudio, AudioManager, type EffectConfig } from "@avoid.quest/radio-audio";

// After
import { useAudio, AudioManager, type EffectConfig } from "@/lib/audio";
```

### Phase 6: Add Missing Effect UIs
Create param editors for effects without UI:

| Component | Parameters |
|-----------|------------|
| `crusher-params.tsx` | crush, bitDepth, boost |
| `fold-params.tsx` | amount, volume, oversample |
| `stereo-tool-params.tsx` | volume, pan, width, invert, swap |
| `revamp-params.tsx` | 7 bands × (freq, Q, gain) |
| `tidal-params.tsx` | rate, depth, slope, symmetry |
| `limiter-params.tsx` | threshold, release [NEW] |

### Phase 7: Cleanup & Package Removal
- Delete `packages/radio-audio/`
- Delete `packages/cacophony/`
- Update `turbo.json` (remove package tasks)
- Update root `package.json` workspaces
- Update any other apps if they used these packages

---

## Critical Files

### Source Files from Cacophony to Port/Simplify
| File | Lines | Action |
|------|-------|--------|
| `packages/cacophony/src/audio-manager.ts` | 1306 | Simplify to ~400 |
| `packages/cacophony/src/stream.ts` | ~200 | Keep streaming logic |
| `packages/cacophony/src/engine.ts` | ~300 | Simplify worklet mgmt |
| `packages/cacophony/src/processors/` | ~2000 | Port with openDAW |

### Source Files from Radio-Audio to Port
| File | Lines | Action |
|------|-------|--------|
| `packages/radio-audio/src/hooks/use-audio.ts` | ~100 | Copy, update imports |
| `packages/radio-audio/src/hooks/use-single-audio.ts` | ~150 | Copy, update imports |
| `packages/radio-audio/src/hooks/use-dj-audio.ts` | ~300 | Copy, update imports |

### Files to Update (Import Changes)
- `apps/radio/src/components/audio/*.tsx` (~10 files)
- `apps/radio/src/components/radio/dj/*.tsx` (~8 files)
- `apps/radio/src/lib/stores/dj-store/*.ts` (~8 files)
- `apps/radio/src/lib/hooks/*.ts` (~4 files)
- `apps/radio/src/components/audio/effect-params/*.tsx` (~10 files)

### Package.json Changes
```json
// apps/radio/package.json
{
  "dependencies": {
    "@opendaw/lib-dsp": "^0.0.50",
    "@opendaw/lib-std": "^0.0.50",
    "@avoid.quest/bandcamp": "workspace:*",
    "@avoid.quest/soundcloud": "workspace:*"
    // REMOVE: "@avoid.quest/cacophony", "@avoid.quest/radio-audio"
  }
}
```

---

## Verification Checklist

### Playback Infrastructure
- [ ] Audio context creation & resume (mobile)
- [ ] Icecast mp3 stream loading
- [ ] Bandcamp stream via proxy
- [ ] SoundCloud stream via proxy
- [ ] Play/pause/stop lifecycle
- [ ] Volume control per-sound
- [ ] Global volume control

### DSP Core
- [ ] Effect chain processing
- [ ] Effect add/remove/reorder
- [ ] All openDAW effects working:
  - [ ] Crusher
  - [ ] Delay
  - [ ] Biquad filter
  - [ ] Revamp (7-band EQ)
  - [ ] Fold
  - [ ] Stereo tool
  - [ ] Tidal
  - [ ] Limiter (new)
  - [ ] Compressor (CTAGDRC)
- [ ] Custom effects working:
  - [ ] Plate reverb
  - [ ] Standard reverb
  - [ ] Phase vocoder
  - [ ] Distortion
- [ ] FFT analysis (if UI added)
- [ ] RMS metering (if UI added)

### App Features
- [ ] Single player: load, play, transitions
- [ ] DJ mode: dual decks, crossfader
- [ ] DJ mode: per-deck effects
- [ ] DJ mode: per-deck filters
- [ ] External: Bandcamp album auto-advance
- [ ] External: SoundCloud playlist auto-advance

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Icecast stream timing differs | Medium | Test with various radio endpoints |
| openDAW effect API changes | Low | Pin version, test thoroughly |
| CTAGDRC undocumented | Medium | Keep current compressor as fallback |
| AudioWorklet bundle size | Low | Tree-shake unused code |
| Mobile audio context quirks | Medium | Port cacophony's resume logic exactly |
| Effect state sync race conditions | Medium | Keep subscription pattern from cacophony |

---

## What We Keep from Cacophony

**Keep (proven patterns):**
- Streaming via fetch + decodeAudioData
- AudioWorklet for real-time processing
- Subscription-based state management
- Effect chain message protocol
- Mobile audio context resume handling
- Bandcamp/SoundCloud proxy integration

**Remove (simplify):**
- Buffer source type (not used)
- Oscillator source type (not used)
- 3D audio positioning (not used)
- Audio cache system (streaming only)
- Synth/SynthGroup classes (not used)
- Multi-instance Playback (not used)

---

## Estimated New File Count

| Directory | Files | Purpose |
|-----------|-------|---------|
| `playback/` | 4 | Streaming infrastructure |
| `dsp/effects/` | ~12 | Effect processors |
| `dsp/analysis/` | 3 | FFT, RMS, Peak |
| `dsp/routing/` | 1 | Graph-based chain |
| `manager/` | 2 | High-level API |
| `hooks/` | 3 | React integration |
| Root | 2 | Index, types |
| **Total** | ~27 | Self-contained audio |
