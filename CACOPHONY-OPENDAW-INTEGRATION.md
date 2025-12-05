# Cacophony openDAW Integration: Status & Implementation Plan

**Last Updated**: 2025-12-05 <!-- 5th of Dec 2025 -->
**Status**: Core Engine Complete | Streaming & Synth Integration In Progress

## Executive Summary

The refactor to use `@opendaw/lib-dsp` and `@opendaw/lib-std` is **~70% complete**. The core AudioWorklet engine architecture is implemented with buffer playback, per-source volume/pan, and basic effects. Remaining work focuses on streaming integration, Synth/Oscillator porting, and feature parity with legacy filters/effects.

**Priority**: Core playback features first (buffers, streaming, volume, pan), then effects/filters.

---

## Architecture Overview

### Current Architecture

```
Main Thread                    AudioWorklet Thread
┌─────────────┐               ┌──────────────────────┐
│ Cacophony   │               │ CacophonyProcessor   │
│   Engine    │◄──messages───►│                      │
└──────┬──────┘               │  ┌────────────────┐  │
       │                      │  │ BufferSource   │  │
       │                      │  │ StreamSource   │  │
┌──────▼──────┐               │  └────────┬───────┘  │
│   Sound     │               │           │          │
│  Playback   │               │  ┌────────▼───────┐  │
└─────────────┘               │  │ Delay Effect   │  │
                              │  └────────┬───────┘  │
                              │           │          │
                              │  ┌────────▼───────┐  │
                              │  │ ChannelStrip   │  │
                              │  └────────┬───────┘  │
                              │           │          │
                              └───────────┼──────────┘
                                          │
                                    Output
```

---

## Implementation Status

### ✅ Completed Features

#### Core Engine Infrastructure

- ✅ **AudioWorklet Architecture** - Complete processor implementation
- ✅ **Protocol System** - Full message protocol with bidirectional communication
- ✅ **Event Propagation** - Worklet → Engine → Playback → Sound event flow
- ✅ **Engine Initialization** - Worklet loading, node creation, message handling

#### Buffer Playback

- ✅ **BufferSource** - Full implementation with play/pause/stop/seek
- ✅ **Buffer Management** - Transfer from main thread to worklet
- ✅ **Playback Control** - start/pause/resume/stop/seek via engine
- ✅ **Loop Support** - Infinite and finite looping
- ✅ **Playback Rate** - Basic rate control (nearest-neighbor interpolation)

#### Per-Source Controls

- ✅ **Volume Control** - Per-source volume via `setSourceVolume()`
- ✅ **Pan Control** - Per-source stereo pan via `setSourcePan()`
- ✅ **State Tracking** - Playing/paused/stopped state management

#### Effects & Processing

- ✅ **ChannelStrip** - Volume, pan, mute with smooth ramping (using `Ramp.linear`)
- ✅ **Delay Effect** - Basic delay with time/feedback/mix control
- ✅ **Smooth Parameter Changes** - No zipper noise via ramping

#### Integration

- ✅ **Sound.preplay()** - Refactored for buffer-based sounds (engine mode)
- ✅ **Playback Class** - Dual-mode support (engine + legacy fallback)
- ✅ **Volume/Pan Setters** - Mapped to engine commands in Playback

### ⚠️ Partially Complete

#### Streaming

- ⚠️ **Stream Integration** - `createStream()` routes chunks to engine, but:
  - Sound.preplay() still uses legacy MediaElementSource for Streaming/HTML types
  - Hybrid mode (MediaElementSource → Engine input) works but not optimal
  - Need full engine-based streaming path

#### Effects

- ⚠️ **Delay Effect** - Implemented but only mono (L channel only)
  - Needs stereo delay or dual delay instances
- ⚠️ **Effect Chain** - Only delay exists, no filter support yet

### ❌ Not Started / Missing

#### Core Features

- ❌ **Streaming (Full Engine)** - Complete engine-based streaming path
  - Current: Hybrid MediaElementSource approach
  - Needed: Full StreamSource integration in Sound.preplay()
- ❌ **Synth/Oscillator** - Not ported to engine
  - Current: Legacy Web Audio OscillatorNode
  - Needed: OscillatorSource in worklet

#### Filters & Effects

- ❌ **BiquadFilter Support** - No filter processing in engine
  - Legacy: FilterManager with BiquadFilterNode chain
  - Needed: BiquadFilter processor in worklet (openDAW has `biquad-processor.ts`)
- ❌ **Filter Chain** - No per-source filter support
- ❌ **Multiple Effects** - Only delay exists, need:
  - Reverb (openDAW has components)
  - Compressor
  - Distortion
  - Phase Vocoder (already exists as separate worklet)

#### Spatial Audio

- ❌ **HRTF Panning** - Only stereo pan exists
  - Legacy: PannerNode with 3D positioning
  - Needed: HRTF processing in worklet (complex, may defer - low priority)

#### Advanced Features

- ❌ **Better Interpolation** - Currently nearest-neighbor
  - Needed: Linear or cubic interpolation for playback rate changes
- ❌ **Peak Metering** - Protocol exists but not implemented
- ❌ **Solo Support** - ChannelStrip has solo flag but not implemented

#### Testing & Cleanup

- ❌ **Test Updates** - All tests need AudioWorklet mocking
- ❌ **Legacy Code Cleanup** - Remove old node creation paths
- ❌ **Documentation** - Update API docs for engine-based features

---

## Detailed Feature Comparison

### Playback Control

| Feature       | Legacy | Engine | Status                   |
| ------------- | ------ | ------ | ------------------------ |
| Play          | ✅     | ✅     | Complete                 |
| Pause         | ✅     | ✅     | Complete                 |
| Resume        | ✅     | ✅     | Complete                 |
| Stop          | ✅     | ✅     | Complete                 |
| Seek          | ✅     | ✅     | Complete                 |
| Loop          | ✅     | ✅     | Complete                 |
| Playback Rate | ✅     | ⚠️     | Basic (nearest-neighbor) |

### Volume & Panning

| Feature         | Legacy | Engine | Status                    |
| --------------- | ------ | ------ | ------------------------- |
| Global Volume   | ✅     | ✅     | Complete                  |
| Sound Volume    | ✅     | ✅     | Via engine                |
| Playback Volume | ✅     | ✅     | Per-source                |
| Stereo Pan      | ✅     | ✅     | Complete                  |
| HRTF Pan        | ✅     | ❌     | Not ported (low priority) |
| 3D Positioning  | ✅     | ❌     | Not ported (low priority) |

### Audio Sources

| Source Type         | Legacy | Engine | Status      |
| ------------------- | ------ | ------ | ----------- |
| AudioBuffer         | ✅     | ✅     | Complete    |
| MediaElement (HTML) | ✅     | ⚠️     | Hybrid mode |
| Streaming           | ✅     | ⚠️     | Hybrid mode |
| Oscillator          | ✅     | ❌     | Not ported  |

### Effects & Filters

| Effect        | Legacy | Engine | Status           |
| ------------- | ------ | ------ | ---------------- |
| BiquadFilter  | ✅     | ❌     | Not ported       |
| Delay         | ✅     | ⚠️     | Mono only        |
| Reverb        | ✅     | ❌     | Not ported       |
| Compressor    | ✅     | ❌     | Not ported       |
| Distortion    | ✅     | ❌     | Not ported       |
| Phase Vocoder | ✅     | ✅     | Separate worklet |

---

## Implementation Plan

### Phase 1: Core Playback Completion (Priority: HIGH)

#### 1.1 Full Streaming Integration

**Files**: `packages/cacophony/src/sound.ts`, `packages/cacophony/src/stream.ts`

**Current State**:

- `createStream()` sends chunks to engine ✅
- `Sound.preplay()` uses legacy MediaElementSource for Streaming/HTML ❌

**Required Changes**:

1. Update `Sound.preplay()` to use engine StreamSource for Streaming type
2. Remove hybrid MediaElementSource path for Streaming
3. Keep HTML type on legacy (or port later)
4. **Remove legacy streaming code immediately after replacement is complete**

**Implementation**:

```typescript
// In sound.ts preplay()
if (this.soundType === SoundType.Streaming) {
  // Create stream source in engine
  engine.createStreamSource(sourceId);

  // Start streaming (createStream handles chunk delivery)
  createStream(this.url, this.context, engine, sourceId, signal);

  // Create engine-based playback
  const playback = new Playback(this, sourceId, engine);
  // ... event setup ...
  return [playback];
}
```

#### 1.2 Synth/Oscillator Porting

**Files**: `packages/cacophony/src/synth.ts`, `packages/cacophony/src/processors/source.ts`

**Required Changes**:

1. Create `OscillatorSource` class in worklet (similar to BufferSource)
2. Add oscillator message types to protocol
3. Update `Synth.preplay()` to use engine
4. Port oscillator parameters (frequency, detune, type)
5. **Remove legacy OscillatorNode code immediately after replacement is complete**

**Implementation**:

- Add `OscillatorSource` extending `Source` in `source.ts`
- Implement waveform generation (sine, sawtooth, square, triangle)
- Add `CREATE_OSCILLATOR_SOURCE` message type
- Update `Synth` class to use engine instead of OscillatorNode

### Phase 2: Effects & Filters (Priority: MEDIUM)

#### 2.1 BiquadFilter Processor

**Files**: `packages/cacophony/src/processors/effects/biquad-filter.ts`

**Reference**: `apps/openDAW/packages/lib/dsp/src/biquad-processor.ts`, `biquad-coeff.ts`

**Required Changes**:

1. Port BiquadFilter processor from openDAW
2. Add filter chain support in CacophonyProcessor
3. Update protocol for filter parameters
4. Integrate with FilterManager API
5. **Remove legacy BiquadFilterNode usage immediately after replacement is complete**

#### 2.2 Stereo Delay

**Files**: `packages/cacophony/src/processors/effects/delay.ts`

**Required Changes**:

1. Create `StereoDelay` class (or use two Delay instances)
2. Update processor to apply delay to both L and R channels

#### 2.3 Effect Chain Architecture

**Files**: `packages/cacophony/src/processors/core/cacophony-processor.ts`

**Required Changes**:

1. Support per-source effect chains (for individual sounds)
2. Support per-deck effect chains (for DJ left/right decks)
3. Support global effect chains (for future mixer features)
4. Allow multiple effects per chain with ordering
5. Flexible routing architecture for future expansion

**Design**:

- Each source can have its own effect chain
- Each deck (left/right) can have a shared effect chain
- Global effects apply to final mix
- Chain ordering: Source → Source Effects → Deck Effects → Global Effects → ChannelStrip → Output

### Phase 3: Advanced Features (Priority: LOW)

#### 3.1 HRTF Panning

**Complexity**: High - requires HRTF convolution or spatial audio processing  
**Priority**: Low (nice-to-have, can defer)

**Required Changes**:

1. Port HRTF processing to worklet (reference openDAW spatial audio if available)
2. Add HRTF message types to protocol
3. Update PannerMixin to use engine for HRTF mode
4. Remove legacy PannerNode usage

#### 3.2 Better Interpolation

**Files**: `packages/cacophony/src/processors/source.ts`

**Required Changes**:

- Replace nearest-neighbor with linear interpolation
- Consider cubic interpolation for high-quality playback rate changes

#### 3.3 Peak Metering

**Files**: `packages/cacophony/src/processors/channel-strip.ts`

**Required Changes**:

- Implement peak detection
- Emit PEAK_METER messages periodically
- Expose via engine API

### Phase 4: Testing & Cleanup (Priority: HIGH)

#### 4.1 Test Infrastructure

**Files**: All `*.test.ts` files

**Required Changes**:

1. Create AudioWorklet mock utilities
2. Update all tests to use mocks
3. Add integration tests for engine features

#### 4.2 Legacy Code Removal

**Files**: `packages/cacophony/src/sound.ts`, `packages/cacophony/src/playback.ts`, and all legacy implementations

**Required Changes**:

1. **Immediately remove** legacy fallback paths after replacement is complete and tested
2. Remove dual-mode support from Playback class (engine-only)
3. Remove legacy node creation from Sound.preplay()
4. Clean up unused mixins (volume-mixin, panner-mixin) if fully ported
5. Remove `globalGainNode` dependency (keep only for EffectManager compatibility if needed)
6. Remove legacy FilterManager Web Audio node chains
7. Delete unused legacy processor files

**Removal Strategy**:

- As each feature is ported, immediately remove the legacy implementation
- No dual-mode support needed - engine is the only path
- Remove legacy code in same PR as replacement implementation

#### 4.3 Documentation

**Files**: `packages/cacophony/README.md`, API docs

**Required Changes**:

1. Document engine-based features
2. Migration guide from legacy to engine
3. Performance characteristics (rely on openDAW quality)

---

## File-by-File Status

### Core Engine Files

| File                                         | Status      | Notes                                                 |
| -------------------------------------------- | ----------- | ----------------------------------------------------- |
| `src/engine/cacophony-engine.ts`             | ✅ Complete | All methods implemented                               |
| `src/protocol.ts`                            | ✅ Complete | All message types defined                             |
| `src/processors/core/cacophony-processor.ts` | ✅ Complete | Core processing done                                  |
| `src/processors/source.ts`                   | ⚠️ Partial  | BufferSource ✅, StreamSource ✅, OscillatorSource ❌ |
| `src/processors/channel-strip.ts`            | ✅ Complete | Volume/pan/mute working                               |
| `src/processors/effects/delay.ts`            | ⚠️ Partial  | Mono only, needs stereo                               |

### Integration Files

| File              | Status         | Notes                                      |
| ----------------- | -------------- | ------------------------------------------ |
| `src/sound.ts`    | ⚠️ Partial     | Buffers ✅, Streaming ⚠️, HTML ⚠️          |
| `src/playback.ts` | ⚠️ Partial     | Engine mode ✅, legacy mode still used     |
| `src/synth.ts`    | ❌ Not Started | Still uses OscillatorNode                  |
| `src/stream.ts`   | ⚠️ Partial     | Chunks to engine ✅, but Sound uses legacy |

### Missing Files (Need Creation)

| File                                          | Purpose                 |
| --------------------------------------------- | ----------------------- |
| `src/processors/effects/biquad-filter.ts`     | BiquadFilter processor  |
| `src/processors/effects/stereo-delay.ts`      | Stereo delay wrapper    |
| `src/processors/source.ts` (OscillatorSource) | Oscillator source class |

---

## Critical Path Items

### Blocking Issues

1. **Streaming Integration** - Sound.preplay() needs full engine path
2. **Synth Porting** - Required for feature parity
3. **Test Infrastructure** - Blocking verification

### Non-Blocking (Can Defer)

1. HRTF panning (low priority, nice-to-have)
2. Advanced effects (reverb, compressor)
3. Better interpolation (nearest-neighbor works)

---

## Success Criteria

### Minimum Viable Product (MVP)

- ✅ Buffer playback works
- ⚠️ Streaming works (hybrid mode acceptable)
- ❌ Synth works (needs porting)
- ✅ Volume/pan control works
- ⚠️ Basic effects (delay mono only)

### Feature Complete

- ✅ All core playback features
- ✅ Full streaming integration
- ✅ Synth ported to engine
- ✅ BiquadFilter support
- ✅ Stereo delay
- ✅ All tests passing
- ✅ No audio glitches
- ✅ All legacy code removed

### Production Ready

- ✅ All legacy code removed
- ✅ No memory leaks
- ✅ Works in all target browsers
- ✅ Documentation complete
- ✅ Migration guide available
- ✅ openDAW-quality implementation (production-ready by design)

---

## Next Immediate Steps

1. **Streaming Integration** (1-2 days)

   - Update `Sound.preplay()` for Streaming type
   - Remove hybrid MediaElementSource path
   - Test with radio streams
   - Verify chunk delivery
   - **Remove legacy streaming code immediately after**

2. **Synth Porting** (2-3 days)

   - Create OscillatorSource
   - Update protocol
   - Update Synth class
   - Test oscillator playback
   - **Remove legacy OscillatorNode code immediately after**

3. **BiquadFilter Porting** (2-3 days)

   - Port biquad processor from openDAW
   - Add filter chain support
   - Integrate with FilterManager API
   - **Remove legacy BiquadFilterNode usage immediately after**

4. **Test Infrastructure** (1-2 days)

   - Create AudioWorklet mocks
   - Update existing tests
   - Add engine integration tests

5. **Legacy Cleanup** (1-2 days)
   - Remove all legacy fallback paths
   - Remove dual-mode support
   - Clean up unused mixins and files

**Total Estimated Effort**: 8-12 days for core completion + cleanup

---

## Design Decisions

1. **HRTF Panning**: Port to worklet (low priority, nice-to-have). Can defer until core features complete.
2. **Filter Chain**: Per-DJ-deck (left/right) but architecture should support per-source and global effects for future mixer features.
3. **Effect Routing**: Support both per-source and global effects. Architecture should be flexible for advanced mixer chains.
4. **Legacy Support**: Remove legacy fallback paths immediately after replacement implementations are complete and tested.
5. **Performance**: Rely on openDAW implementation quality. No separate benchmarking needed - openDAW components are production-ready.

---

## Notes

- **Hybrid Mode**: Currently using MediaElementSource → Engine input for Streaming/HTML. This works but isn't optimal. Full engine path preferred.
- **Delay Mono Issue**: Delay only processes L channel. Need stereo delay or dual instances.
- **Interpolation**: Nearest-neighbor is fast but low quality. Linear interpolation would improve playback rate changes.
- **openDAW Reference**: See `apps/openDAW/packages/lib/dsp/` for available DSP components to port.
- **Legacy Removal**: As each feature is ported, immediately remove the legacy implementation. No dual-mode support needed.

---

## Implementation Todos

- [ ] **streaming-full**: Complete full engine-based streaming: Update Sound.preplay() to use StreamSource for Streaming type, remove hybrid MediaElementSource path
- [ ] **synth-port**: Port Synth/Oscillator to engine: Create OscillatorSource class in worklet, update protocol, refactor Synth.preplay() to use engine
- [ ] **biquad-filter**: Port BiquadFilter to engine: Create biquad-filter processor using openDAW components, add filter chain support in processor
- [ ] **stereo-delay**: Fix delay effect: Implement stereo delay (either StereoDelay class or dual Delay instances for L/R channels)
- [ ] **test-infra**: Create test infrastructure: Build AudioWorklet mocks, update all tests to use mocks, add engine integration tests
- [ ] **legacy-cleanup**: Clean up legacy code: Remove legacy fallback paths once stable, clean up unused mixins, reduce globalGainNode dependency
- [ ] **interpolation**: Improve playback rate: Replace nearest-neighbor with linear interpolation for better quality
- [ ] **peak-metering**: Implement peak metering: Add peak detection in ChannelStrip, emit PEAK_METER messages, expose via engine API
