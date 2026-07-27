# openDAW effects implementation

## Architecture

The radio routes stock-only effect chains through the official client-side
openDAW engine:

```text
deck AudioNode
  -> openDAW monitoring input
  -> Tape audio unit
  -> Rust/WASM stock-effect graph
  -> openDAW monitoring return
  -> radio cue/fader/meter/output graph
```

One shared openDAW `Project` owns one Tape audio unit per monitored live source.
That keeps deck-to-deck sidechains inside one graph and gives Delay and Tidal
one persisted session tempo. The project never uploads deck audio or performs
server-side audio processing.

Vite serves and emits the engine, realtime worklet, offline worker, the plugin
WASMs present in the installed openDAW package, and the lazy NAM runtime at
stable `/opendaw/*` URLs. Development and production builds use the same
package-derived assets; generated WASM files are not copied into source control.

The radio AudioWorklet remains the compatibility runtime whenever a chain
contains the radio-only Pitch/Speed, arctangent Distortion, or Limiter. The
whole mixed chain stays ordered and playable there; radio-only effects are not
dropped during migration. If the official engine cannot initialize, all live
graphs reconnect through this compatibility runtime and the app displays a
warning.

The live-radio project intentionally does not initialize openDAW soundfont or
OPFS worker services. Stock effects and Tape monitoring do not need them.
Project sample and soundfont managers therefore fail explicitly if a device
tries to request those unavailable resources.

## Supported devices

The picker exposes these exact 19 official devices and containers:

| Kind | Radio label | openDAW device |
| --- | --- | --- |
| Effect | Dattorro Reverb | `DattorroReverb` |
| Effect | Crusher | `Crusher` |
| Effect | Fold | `Fold` |
| Effect | 7-Band EQ | `Revamp` |
| Effect | Delay | `Delay` |
| Effect | Compressor | `Compressor` |
| Effect | Stereo Tool | `StereoTool` |
| Effect | Tidal | `Tidal` |
| Effect | Free Reverb | `Reverb` |
| Effect | Gate | `Gate` |
| Effect | Waveshaper | `Waveshaper` |
| Effect | Maximizer | `Maximizer` |
| Effect | Vocoder | `Vocoder` |
| Effect | Tone3000 | `NeuralAmp` |
| Effect | Werkstatt | `Werkstatt` |
| Effect | Autotune | `Autotune` |
| Container | FX Composite | `AudioEffectComposite` |
| Container | Stereo Split | `StereoComposite` |
| Container | Frequency Split | `FrequencySplit` |

FX Composite supports parallel child chains with gain, pan, mute, solo, and
editable names. Stereo Split has fixed Left and Right child chains. Frequency
Split supports two, three, or four bands and ordered crossover frequencies.
All three containers accept recursive nested effects and containers. The
current UI can add, edit, enable, and remove nested children; it does not expose
nested-effect or branch drag reordering.

Compressor and Gate always expose the other live deck as a sidechain input.
Vocoder exposes it when its modulator is set to External sidechain. There is no
separate sidechain-health status display.

Tone3000 reads a user-selected local `.nam` JSON model, persists its contents
locally, and passes it to the official NAM WASM runtime. No model, external
credential, or Tone3000 network request is bundled.

Werkstatt retains openDAW's `ScriptCompiler`, hot-swaps a stable device UUID,
and derives typed/grouped controls from official source declarations. The
playground includes Pass Through and all six official examples, while runtime
messages surface compile and processor failures. The current official
audio-effect bridge does not forward `@sample` data, so the UI explains that
technical limit and only preserves legacy saved reference maps.

Playback-session parsing normalizes legacy flat chains and adds the default
tempo without dropping effect IDs, ordering, radio-only devices, or known
parameter values. Nested routing, crossover state, sidechain channel IDs, and
tempo round-trip through the persisted session schema. The app has no playback
session export/import UI; persistence is verified by reload and focused schema
tests.

## Stream compatibility

Built-in NTS stations use the CORS-enabled canonical streams:

- `https://streams.radiomast.io/nts1`
- `https://streams.radiomast.io/nts2`

Playback also rewrites the two historical
`https://stream-relay-geo.ntslive.net/stream*` URLs to those canonical
endpoints before assigning the media element. Keep
`HTMLMediaElement.crossOrigin = "anonymous"`: Web Audio processing requires a
CORS-readable stream, and removing it would not make the legacy redirect safe
for effects.

## Technical limits

- openDAW monitoring has eight input channels, so the shared runtime supports
  at most four simultaneous stereo sources in one `AudioContext`.
- Attempting a fifth official source currently marks the shared official
  runtime unavailable and reconnects every live source through compatibility
  mode for the remainder of that controller lifetime.
- A Tone3000 device passes audio through until a valid local `.nam` model has
  loaded. A valid model is a user-provided manual-test prerequisite.
- Werkstatt custom sample declarations are unavailable because the radio does
  not provide openDAW project sample storage.
- The published openDAW `EffectBox` type omits Frequency Split even though its
  factory and engine support it. The adapter contains a narrow local type
  workaround pending an upstream declaration fix.
- PWA service-worker requests are network-only. The worker does not cache
  engine, worklet, plugin, WASM, or cross-origin stream responses.

Use [`OPENDAW_MANUAL_TEST_CHECKLIST.md`](./OPENDAW_MANUAL_TEST_CHECKLIST.md) for
the practical browser verification pass.
