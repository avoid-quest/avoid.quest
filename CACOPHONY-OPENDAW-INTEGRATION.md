# Cacophony + openDAW Integration

Technical reference for the cacophony audio engine with openDAW DSP components.

## Architecture

```
Main Thread                         AudioWorklet Thread
┌─────────────────┐                ┌──────────────────────────┐
│ CacophonyEngine │◄──messages────►│ CacophonyProcessor       │
└─────────────────┘                │                          │
                                   │ Sources:                 │
┌─────────────────┐                │  BufferSource            │
│ AudioManager    │                │  StreamSource            │
│ (Radio App)     │                │  OscillatorSource        │
└─────────────────┘                │                          │
                                   │ Processing Chain:        │
                                   │  Source → Filters →      │
                                   │  Effects → ChannelStrip  │
                                   │  → Output                │
                                   └──────────────────────────┘
```

## Effects (11 Total)

| Effect | Source | Key Files |
|--------|--------|-----------|
| **Delay** | `@opendaw/lib-dsp` | `processors/effects/stereo-delay.ts` |
| **Crusher** | `@opendaw/lib-dsp` | `processors/effects/crusher.ts` |
| **DattorroReverb** | Custom | `processors/effects/reverb.ts` |
| **StandardReverb** | Ported FreeVerb | `processors/effects/freeverb-reverb.ts` |
| **Fold** | Ported from openDAW | `processors/effects/fold.ts` |
| **StereoTool** | Ported from openDAW | `processors/effects/stereo-tool.ts` |
| **Revamp** | Ported from openDAW | `processors/effects/revamp.ts` |
| **Tidal** | Ported from openDAW | `processors/effects/tidal.ts` |
| **Distortion** | Custom | `processors/effects/distortion.ts` |
| **PhaseVocoder** | Custom | `processors/effects/phase-vocoder.ts` |
| **Compressor** | Custom | `processors/effects/compressor.ts` |

## openDAW Components Used

**Direct Imports from `@opendaw/lib-dsp`**:
- `Delay` - Stereo delay line
- `Crusher` - Bit reduction
- `Ramp` - Smooth parameter changes
- `StereoMatrix` - Stereo processing
- `dbToGain`, `RenderQuantum` - Utilities

**Ported from openDAW Device Processors**:
- `FreeVerb` - Room reverb
- `Fold` - Wave folding
- `StereoTool` - Stereo transformation
- `Revamp` - 7-band parametric EQ
- `Tidal` - Rhythm shaping

## Key Files

| File | Purpose |
|------|---------|
| `engine/cacophony-engine.ts` | Main thread API |
| `processors/core/cacophony-processor.ts` | Worklet processor |
| `processors/source.ts` | Sources + effect chain |
| `protocol.ts` | Message definitions |
| `audio-manager.ts` | High-level radio API |
| `effects/types.ts` | Effect config types |
| `effects/registry.ts` | Effect metadata |

## Adding a New Effect

1. Create processor in `processors/effects/{name}.ts`
2. Add effect type to `protocol.ts` `EffectType`
3. Add to `Source.addEffect()` switch in `source.ts`
4. Add to `Source.updateEffect()` instanceof checks
5. Add config type to `effects/types.ts`
6. Add metadata to `effects/registry.ts`
7. Create UI component in `apps/radio/src/components/audio/effect-params/`

## Streaming

Radio streaming uses `StreamSource`:
1. `Sound.preplay()` creates stream source via engine
2. `createStream()` fetches URL, accumulates chunks (64-256KB)
3. Decode via `decodeAudioData()` on main thread
4. Send decoded PCM to worklet via `engine.addStreamChunk()`
5. `StreamSource` buffers and processes in worklet

## Pending (Low Priority)

- **CTAGDRC Compressor** - API docs needed for constructor args
- **Linear Interpolation** - Better playback rate quality
- **Peak Metering** - Protocol defined, not implemented
