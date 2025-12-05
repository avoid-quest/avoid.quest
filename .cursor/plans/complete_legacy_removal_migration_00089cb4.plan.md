---
name: Complete Legacy Removal Migration
overview: Remove all legacy code paths and move everything to engine-based methods. This includes removing HTML Audio support, EffectManager, globalGainNode, dual-mode Playback, and all legacy mixins/fallbacks. Ensure 100% feature parity with engine-only implementation.
todos:
  - id: port-reverb
    content: Port Dattorro reverb from separate worklet into main CacophonyProcessor
    status: pending
  - id: port-phase-vocoder
    content: Port phase vocoder from separate worklet into main CacophonyProcessor
    status: pending
  - id: port-distortion
    content: Implement distortion effect in engine processor
    status: pending
  - id: port-compressor
    content: Implement compressor effect in engine processor
    status: pending
  - id: remove-html-audio
    content: Remove SoundType.HTML support and migrate radio streams to engine streaming
    status: pending
  - id: remove-dual-mode
    content: Remove isEngineBased flag and legacy Playback constructor paths
    status: pending
  - id: remove-effect-manager
    content: Remove EffectManager and replace with engine effect API
    status: pending
  - id: remove-global-gain
    content: Remove globalGainNode and update routing
    status: pending
  - id: cleanup-mixins
    content: Remove or refactor volume-mixin and panner-mixin if only used by legacy code
    status: pending
  - id: update-tests
    content: Fix all tests for engine-only mode and add effect integration tests
    status: pending
  - id: update-docs
    content: Update documentation to reflect engine-only architecture
    status: pending
---

# Complete Legacy Code Removal Plan

## Overview

Remove all legacy mechanisms and ensure 100% engine-based implementation. This is a comprehensive cleanup to eliminate dual-mode support, legacy fallbacks, and unused code.

## Current State Analysis

### Already Engine-Based ✅

- Buffer playback (AudioBuffer sources)
- Oscillator/Synth playback
- Streaming (StreamSource in worklet)
- BiquadFilter
- StereoDelay
- ChannelStrip (volume/pan/mute)

### Still Using Legacy ⚠️

- **SoundType.HTML** - Uses MediaElementSource (legacy)
- **EffectManager** - Web Audio node chains (legacy)
- **globalGainNode** - Used by EffectManager
- **Playback dual-mode** - `isEngineBased` flag with legacy fallback
- **Mixins** - volume-mixin, panner-mixin (partially used)
- **Legacy filter chains** - Web Audio node connections

### Effects Status

- ✅ BiquadFilter - Engine
- ✅ StereoDelay - Engine  
- ⚠️ Reverb (Dattorro) - Separate worklet, used via EffectManager
- ⚠️ PhaseVocoder - Separate worklet, used via EffectManager
- ❌ Distortion - Not ported
- ❌ Compressor - Not ported

## Implementation Plan

### Phase 1: Port Missing Effects to Engine (Priority: HIGH)

#### 1.1 Port Reverb to Engine

**Files**:

- `packages/cacophony/src/processors/effects/reverb.ts` (create)
- `packages/cacophony/src/processors/core/cacophony-processor.ts` (integrate)
- `packages/cacophony/src/engine/cacophony-engine.ts` (add API)
- `packages/cacophony/src/protocol.ts` (add messages)

**Action**: Port Dattorro reverb algorithm from separate worklet into main processor. Reference `packages/cacophony/src/processors/dattorro-reverb.ts` and openDAW reverb implementations.

#### 1.2 Port PhaseVocoder to Engine

**Files**:

- `packages/cacophony/src/processors/effects/phase-vocoder.ts` (create)
- `packages/cacophony/src/processors/core/cacophony-processor.ts` (integrate)
- `packages/cacophony/src/engine/cacophony-engine.ts` (add API)
- `packages/cacophony/src/protocol.ts` (add messages)

**Action**: Port phase vocoder from separate worklet into main processor. Reference existing phase-vocoder-bundle.

#### 1.3 Port Distortion to Engine

**Files**:

- `packages/cacophony/src/processors/effects/distortion.ts` (create)
- `packages/cacophony/src/processors/core/cacophony-processor.ts` (integrate)
- `packages/cacophony/src/engine/cacophony-engine.ts` (add API)
- `packages/cacophony/src/protocol.ts` (add messages)

**Action**: Implement distortion using WaveShaper or openDAW distortion algorithms.

#### 1.4 Port Compressor to Engine

**Files**:

- `packages/cacophony/src/processors/effects/compressor.ts` (create)
- `packages/cacophony/src/processors/core/cacophony-processor.ts` (integrate)
- `packages/cacophony/src/engine/cacophony-engine.ts` (add API)
- `packages/cacophony/src/protocol.ts` (add messages)

**Action**: Port DynamicsCompressorNode logic or use openDAW compressor implementation.

### Phase 2: Remove HTML Audio Support (Priority: HIGH)

#### 2.1 Remove SoundType.HTML

**Files**:

- `packages/cacophony/src/sound.ts` - Remove HTML Audio path in `preplay()`
- `packages/cacophony/src/cacophony.ts` - Remove HTML sound creation
- `packages/radio-audio/src/audio-manager.ts` - Change radio streams to use `SoundType.Streaming` with engine

**Action**:

- Remove `initializeSharedAudioElement()` and `_sharedAudioElement` from Sound
- Remove `SoundType.HTML` enum value (or mark deprecated)
- Update radio streams to use engine StreamSource instead of HTML Audio
- Remove MediaElementSource creation code

### Phase 3: Remove Legacy Playback Mode (Priority: HIGH)

#### 3.1 Remove Dual-Mode from Playback

**Files**:

- `packages/cacophony/src/playback.ts`

**Action**:

- Remove `isEngineBased` flag
- Remove legacy constructor path `(origin, source, gainNode)`
- Remove all `if (this.isEngineBased)` conditionals
- Remove legacy `source`, `gainNode`, `panner` Web Audio node setup
- Remove `refreshFilters()` (legacy filter chain)
- Remove `outputNode`, `connect()`, `disconnect()` (legacy routing)
- Keep only engine-based constructor: `(origin, sourceId, engine)`
- Remove `clone()` method (or rewrite for engine-only)

#### 3.2 Remove Legacy Sound.preplay() Paths

**Files**:

- `packages/cacophony/src/sound.ts`

**Action**:

- Remove MediaElementSource creation
- Remove legacy Playback instantiation
- Ensure all paths use engine only
- Remove `_sharedMediaSource` and related code

### Phase 4: Remove EffectManager (Priority: HIGH)

#### 4.1 Remove EffectManager Usage

**Files**:

- `packages/radio-audio/src/audio-manager.ts` - Remove all EffectManager usage
- `packages/radio-audio/src/effects/effect-manager.ts` - Delete file
- `packages/radio-audio/src/effects/types.ts` - Update or remove
- `packages/radio-audio/src/effects/registry.ts` - Update or remove

**Action**:

- Replace EffectManager calls with engine effect API
- Update `addEffect()`, `removeEffect()`, `updateEffect()` to use engine
- Remove `effectManagers` Map from AudioManager
- Remove `getEffectManager()` method

#### 4.2 Add Engine Effect API

**Files**:

- `packages/cacophony/src/engine/cacophony-engine.ts` - Add effect management methods
- `packages/cacophony/src/protocol.ts` - Add effect messages

**Action**:

- Add `addEffect(sourceId, effectType, config)`
- Add `removeEffect(sourceId, effectId)`
- Add `updateEffect(sourceId, effectId, config)`
- Add `reorderEffects(sourceId, effectIds)`

### Phase 5: Remove globalGainNode (Priority: HIGH)

#### 5.1 Remove globalGainNode

**Files**:

- `packages/cacophony/src/cacophony.ts` - Remove `globalGainNode` property
- `packages/cacophony/src/cacophony.test.ts` - Update tests
- `packages/radio-audio/src/audio-manager.ts` - Remove references

**Action**:

- Remove `globalGainNode` creation in constructor
- Remove `globalGainNode` from volume control
- Update engine routing to connect directly to `context.destination`
- Remove `connectInput()` usage (engine handles routing internally)

### Phase 6: Clean Up Mixins (Priority: MEDIUM)

#### 6.1 Remove/Refactor Mixins

**Files**:

- `packages/cacophony/src/volume-mixin.ts` - Check if still needed
- `packages/cacophony/src/panner-mixin.ts` - Check if still needed
- `packages/cacophony/src/base-playback.ts` - Remove mixin usage if not needed

**Action**:

- If mixins are only used for legacy code, remove them
- If mixins provide shared logic, refactor to composition or base class
- Remove `PannerMixin` if HRTF is not ported (only stereo pan exists)
- Keep `VolumeMixin` only if it's used by engine-based code

### Phase 7: Remove Legacy Filter Chains (Priority: MEDIUM)

#### 7.1 Remove Legacy Filter Management

**Files**:

- `packages/cacophony/src/filters.ts` - Check FilterManager usage
- `packages/cacophony/src/playback.ts` - Remove `refreshFilters()`

**Action**:

- If FilterManager only manages Web Audio node chains, remove it
- Engine handles filters via `addFilter()`, `removeFilter()`, `setFilterParam()`
- Remove `applyFilters()` if it's for legacy node chains

### Phase 8: Update Tests (Priority: HIGH)

#### 8.1 Fix Test Infrastructure

**Files**: All `*.test.ts` files

**Action**:

- Remove legacy mode tests
- Update mocks to only support engine mode
- Remove `globalGainNode` test assertions
- Update Sound/Playback tests for engine-only
- Add integration tests for all effects in engine

### Phase 9: Update Documentation (Priority: LOW)

#### 9.1 Update Docs

**Files**:

- `CACOPHONY-OPENDAW-INTEGRATION.md` - Mark as complete
- `packages/cacophony/README.md` - Update API docs

**Action**:

- Document engine-only API
- Remove legacy examples
- Update migration guide

## File-by-File Changes

### Core Files to Modify

1. **packages/cacophony/src/sound.ts**

- Remove `_sharedAudioElement`, `_sharedMediaSource`
- Remove `initializeSharedAudioElement()`
- Remove HTML Audio path in `preplay()`
- Engine-only mode

2. **packages/cacophony/src/playback.ts**

- Remove dual-mode constructor
- Remove `isEngineBased` flag
- Remove legacy Web Audio node code
- Remove `refreshFilters()`, `outputNode`, `connect()`, `disconnect()`
- Engine-only implementation

3. **packages/cacophony/src/cacophony.ts**

- Remove `globalGainNode`
- Update volume control to use engine only
- Remove `SoundType.HTML` support

4. **packages/cacophony/src/engine/cacophony-engine.ts**

- Add effect management API
- Ensure direct connection to destination

5. **packages/cacophony/src/processors/core/cacophony-processor.ts**

- Add reverb, phase vocoder, distortion, compressor processing
- Integrate into effect chain

6. **packages/radio-audio/src/audio-manager.ts**

- Remove EffectManager usage
- Use engine effect API instead
- Change radio streams to `SoundType.Streaming`

### Files to Delete

- `packages/radio-audio/src/effects/effect-manager.ts`
- Separate worklet bundles (if integrated into main processor):
- `packages/cacophony/src/bundles/dattorro-reverb-bundle.js` (if ported)
- `packages/cacophony/src/bundles/phase-vocoder-bundle.js` (if ported)

## Success Criteria

- ✅ All audio sources use engine (no legacy Web Audio nodes)
- ✅ All effects use engine (no EffectManager)
- ✅ No `globalGainNode` dependency
- ✅ No dual-mode code paths
- ✅ All tests pass
- ✅ Feature parity with starting point
- ✅ Radio streams work with engine streaming
- ✅ All effects (reverb, phase vocoder, distortion, compressor) work in engine

## Risk Assessment

**High Risk**:

- Radio streaming migration (HTML → Engine streaming)
- Effect porting (complex algorithms)

**Medium Risk**:

- Test updates (may need significant refactoring)
- API changes breaking existing code

**Low Risk**:

- Removing unused code
- Documentation updates

## Testing Strategy

1. **Unit Tests**: Update all existing tests for engine-only mode
2. **Integration Tests**: Test each effect in engine
3. **E2E Tests**: Test radio streaming with engine
4. **Manual Testing**: Verify all features work in radio app