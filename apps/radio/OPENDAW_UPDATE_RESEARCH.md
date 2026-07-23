# openDAW update research

Research date: **2026-07-23** (Europe/Rome)

Upstream snapshot: [`andremichelle/openDAW@16f065a`](https://github.com/andremichelle/openDAW/commit/16f065a258fdbc27ffcb208e928f958339a1610f)

Latest published SDK tag:
[`@opendaw/studio-sdk@0.0.162`](https://github.com/andremichelle/openDAW/releases/tag/%40opendaw%2Fstudio-sdk%400.0.162)
at [`a85f975`](https://github.com/andremichelle/openDAW/commit/a85f975d766647670ef37e4fcbe0f75901642e72)

## Decision summary

The radio app is not simply a few openDAW package versions behind. It currently
uses `@opendaw/lib-dsp` primitives inside its own AudioWorklet and implements
its own effect model, processor lifecycle, persistence, UI, and MIDI bindings.
The latest openDAW stock effects instead ship as device modules for openDAW's
shared Rust/WASM engine.

The current radio catalog has 11 effects. Against openDAW's 16 discrete stock
audio effects:

- 4 have close equivalents: Dattorro Reverb, Crusher, Fold, and Revamp;
- 4 are present but below current openDAW parity: Delay, Compressor, Stereo
  Tool, and Tidal;
- 8 are missing: Cheap Reverb, Gate, Waveshaper, Maximizer, Vocoder, Neural
  Amp/Tone3000, Werkstatt, and Autotune;
- 3 new effect-chain containers are also missing: FX Composite, Stereo Split,
  and Frequency Split.

The radio-only Pitch/Speed, arctangent Distortion, and simple Limiter are useful
custom effects, but they are not equivalents for openDAW's Autotune,
Waveshaper, or Maximizer.

There are therefore two materially different implementation choices:

1. **Keep the radio engine and port selected behavior.** This preserves the
   current stream-oriented graph and stored sessions, but does not literally
   consume openDAW's device WASMs. Reaching feature parity means 8 new effects,
   4 parity upgrades, and 3 nested routing models.
2. **Adopt `@opendaw/studio-sdk` and its WASM engine.** This consumes the stock
   devices and future upstream work directly, but it is an audio-engine and
   state-model migration, not an incremental effect addition. It also needs a
   licensing decision before implementation.

**Recommended decision gate:** use the full SDK only if ongoing upstream parity
is the product goal and its AGPL/commercial-license path is acceptable.
Otherwise keep the radio engine, upgrade its two existing openDAW libraries,
and add radio-relevant effects in small phases. No implementation or dependency
change was made during this research.

## What changed upstream

The concentrated upstream work happened in July 2026:

- the SDK packaging was declared ready on July 6
  ([commit](https://github.com/andremichelle/openDAW/commit/84b50f6f92d6472e9f16e890f368ef43ddfe7a2c));
- openDAW marked the WASM audio engine complete on July 7
  ([commit](https://github.com/andremichelle/openDAW/commit/c419f85443e5aa54599197aa0552e8d39def2ca5));
- the TypeScript engine was removed on July 16
  ([commit](https://github.com/andremichelle/openDAW/commit/bcc5adbaadc3e955b2f8b8a36bb51b68d785f730));
- parallel FX stacks and stereo split landed on July 17
  ([commit](https://github.com/andremichelle/openDAW/commit/3ca49ce09e172f6f52f2cb20abf65e78df4111a3));
- Autotune and Frequency Split landed on July 21
  ([Autotune](https://github.com/andremichelle/openDAW/commit/0106cf80dec3610d18dd13272a0f3a5e7d5378a4),
  [Frequency Split](https://github.com/andremichelle/openDAW/commit/636404633be812d1f31897ac00f4056bd9a41ef4)).

The current official device list describes Cheap Reverb, Dattorro Reverb,
Delay, Gate, Maximizer, Vocoder, Waveshaper, Werkstatt, Autotune, Tone3000, and
the split/composite devices alongside the effects the radio already knows
([official catalog](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/README.md#L96-L133)).

The source-of-truth WASM registry classifies 16 modules as audio effects and
shows the three engine-native composite types
([device modules](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/core-wasm/src/engine-modules.ts#L82-L113),
[effect composites](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/core-wasm/src/engine-modules.ts#L131-L161)).

## Package gap

| Package | Radio app | Latest official snapshot | Meaning |
| --- | ---: | ---: | --- |
| `@opendaw/lib-dsp` | `0.0.84` | `0.0.88` | Safe-looking but narrow primitive-library update |
| `@opendaw/lib-std` | `0.0.78` | `0.0.82` | Includes `Range`/parsing bug fixes in `0.0.80` |
| `@opendaw/studio-sdk` | absent | `0.0.162` | Complete Studio toolchain |
| `@opendaw/studio-core-wasm` | absent | `0.0.7` | Worklet, offline worker, engine WASM, and device WASMs |

The current versions are in the radio
[`package.json`](./package.json). Official package manifests identify
`lib-dsp@0.0.88`, depending on `lib-std@^0.0.82`
([manifest](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/lib/dsp/package.json#L1-L36)),
and `studio-sdk@0.0.162`, which installs the full Studio dependency graph
([SDK manifest](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/sdk/package.json#L1-L59)).

The `lib-dsp` releases from `0.0.84` through `0.0.88` are recorded as
version-only package bumps
([changelog](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/lib/dsp/CHANGELOG.md#L6-L24)).
The source diff adds fast-math helpers and small oscillator/LFO/constants
changes; it does **not** expose the new stock effects from `lib-dsp`. The
meaningful `lib-std` item is the `0.0.80` transaction, `Range`, and parsing
fixes
([changelog](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/lib/std/CHANGELOG.md#L6-L27)).

## Official API surface

`@opendaw/studio-sdk` is a meta-installer, not a facade: its own entry point
exports only `OPENDAW_SDK_VERSION`
([source](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/sdk/src/index.ts)).
Application code imports the real APIs from leaf packages such as
`@opendaw/studio-core` and `@opendaw/studio-core-wasm`.

The release's authoritative supported-effect surface is
`EffectFactories.AudioList`: 19 entries comprising the 16 discrete audio
effects and 3 composites in this report. `EffectFactories.MidiList` separately
contains 5 MIDI effects. If the SDK path is selected, consuming those lists is
safer than maintaining another hand-written catalog
([factory lists](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core/src/EffectFactories.ts#L551-L590)).
Effects are inserted into a project chain with
`ProjectApi.insertEffect(field, factory, insertIndex?)`
([API](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core/src/project/ProjectApi.ts#L169-L171)).

Two other upstream APIs may be relevant but are not live-radio effects:

- `AudioContentModifier.toSignalsmith(...)` installs the newer spectral
  pitch/time-stretch play mode on openDAW audio-content adapters
  ([source](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core/src/project/audio/AudioContentModifier.ts#L39-L63));
  it targets project audio content, so it is not a drop-in replacement for the
  radio app's continuous-stream Pitch/Speed effect.
- `FactoryCatalog.install(provider)` lets a host supply samples, soundfonts,
  and presets; the standalone default catalog is empty
  ([source](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core/src/FactoryCatalog.ts#L4-L21)).

## Effect-by-effect gap

| Latest openDAW audio feature | Radio status | Remaining work |
| --- | --- | --- |
| Dattorro Reverb | Close equivalent as `plateReverb` | Align parameter units and wet/dry semantics if exact preset parity matters |
| Crusher | Close equivalent | Align upstream mix/ranges; radio currently adds its own auto-gain behavior |
| Fold | Close equivalent | Align drive/output ranges and smoothing; radio currently adds auto gain |
| Revamp | Close equivalent | Validate parameter mappings and analyzer behavior against the current device |
| Delay | Partial | Radio only has delay time + feedback; upstream has musical sync, independent pre-delay, cross-feedback, filter, LFO, and wet/dry |
| Compressor | Partial | Add external sidechain routing, current smoothing/telemetry, and exact parameter mappings |
| Stereo Tool | Partial | Processor supports panning internally, but the stored/UI config omits panning and pan-law selection |
| Tidal | Partial | Radio uses a free-running Hz rate; upstream is transport/tempo synced |
| Cheap Reverb | Missing | Add the lighter FreeVerb-style reverb separately from Dattorro |
| Gate | Missing | Add detector envelope, hold/floor/inverse, and optional sidechain |
| Waveshaper | Missing | Radio Distortion is one oversampled `atan` curve; upstream offers selectable hardclip, cubic-soft, tanh, sigmoid, arctan, and asymmetric curves with input/output gain and mix |
| Maximizer | Missing | Radio Limiter has no lookahead or automatic makeup and is not the upstream Maximizer |
| Vocoder | Missing | Needs carrier/modulator model, 8/12/16 bands, noise/self/external sources, and sidechain routing |
| Neural Amp / Tone3000 | Missing | Needs NAM runtime/model loading and a model-source/licensing UX |
| Werkstatt | Missing | Needs user-script storage/editor, dynamic parameters, worklet sandboxing, hot swap, and failure isolation |
| Autotune | Missing | New monophonic pitch correction with key, scale, amount, retune, manual shift, and smoothing |
| FX Composite | Missing container | Nested parallel chains with per-branch gain/pan/mute/solo and overall dry/wet |
| Stereo Split | Missing container | Separate left/right child chains |
| Frequency Split | Missing container | Multiband Linkwitz-Riley routing with a child chain per band |

The upstream registry and device implementations support these distinctions:

- Delay is explicitly stereo, tempo-syncable, filtered, modulated, and
  cross-fed
  ([source](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-delay/src/lib.rs));
- Gate and Compressor can use sidechain inputs
  ([Gate](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-gate/src/lib.rs),
  [Compressor](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-compressor/src/lib.rs));
- Waveshaper has six transfer functions
  ([DSP equations](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/lib/dsp/src/waveshaper.ts));
- Maximizer is a lookahead brickwall limiter with automatic makeup
  ([source](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-maximizer/src/lib.rs));
- Vocoder supports noise, self, and external modulators
  ([source](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-vocoder/src/lib.rs));
- Autotune uses monophonic detection and TD-PSOLA pitch correction
  ([source](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/crates/stock-devices/device-autotune/src/lib.rs)).

## Integration impact in this repository

The current app compiles one custom worklet,
`/dsp-processor-bundle.js`, from
[`worklet-entry.ts`](./src/lib/audio/dsp/worklet-entry.ts) through the custom
Vite plugin in [`vite.config.ts`](./vite.config.ts). Effects are a flat,
serial list:

- runtime identifiers and persisted discriminated unions live in
  [`types.ts`](./src/lib/audio/dsp/effects/types.ts);
- defaults and parameter UI are in
  [`effect-definitions.ts`](./src/lib/audio/dsp/effects/effect-definitions.ts);
- worklet construction and parameter updates are in
  [`processor-source.ts`](./src/lib/audio/dsp/processor-source.ts);
- stored sessions validate effect types in
  [`playback-sessions.ts`](./src/lib/collections/playback-sessions.ts);
- UI icons/picking, visualization, and schema-derived MIDI actions all depend
  on that same effect union.

Adding an ordinary serial effect fits those seams. The three composite devices
do not: they require the persisted effect model and worklet graph to become a
tree, including recursion-safe reordering, nested MIDI action IDs,
import/export migration, and UI nesting.

The official engine cannot be consumed as a bag of standalone effect classes.
`@opendaw/studio-core-wasm` ships one engine, a realtime worklet, an offline
worker, and `wasm/plugins/*.wasm`; the engine fetches and links every registered
device module through its own box graph
([SDK instructions](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/sdk/README.md#L21-L45),
[loader](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/core-wasm/src/engine-modules.ts#L163-L172)).
The current registry hardcodes 26 plugin binaries, and readiness loads the
engine plus all of them in one `Promise.all`; a missing asset rejects the whole
boot. The deployed artifact tree must therefore exactly match the package
version, even if the radio UI exposes only audio effects.

The radio already sends COOP/COEP headers in
[`__root.tsx`](./src/routes/__root.tsx), so the SDK's SharedArrayBuffer
prerequisite is likely satisfied. The larger gaps are:

1. translating radio streams/decks and effect sessions into openDAW's
   Project/Box graph;
2. replacing or wrapping the current worklet protocol and manager;
3. hosting and caching the engine/worklet/worker/plugin artifacts correctly in
   Vite, PWA, and Cloudflare builds;
4. preserving current radio-only effects and existing saved sessions;
5. designing sidechain inputs and nested composite-chain UI;
6. testing CPU, memory, startup time, mobile support, stream continuity, and
   failure recovery.

Current upstream source says WASM readiness failure leaves no working engine
fallback
([`WasmEngine.ensureReady`](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/core-wasm/src/WasmEngine.ts#L37-L55)).
The SDK README still mentions a TypeScript fallback, but that conflicts with the
current implementation and the July 16 TypeScript-engine removal. Integration
must follow the source behavior and fail visibly if the WASM assets cannot load.

## Licensing gate

This is not legal advice, but it is an implementation blocker that needs an
owner decision.

The individually published `lib-dsp`, `lib-std`, and `studio-core-wasm`
manifests declare `LGPL-3.0-or-later`
([`lib-dsp`](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/lib/dsp/package.json#L1-L20),
[`studio-core-wasm`](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/core-wasm/package.json#L1-L20)).
However, the official SDK README says the complete integration is AGPL v3+
or commercial-license territory, and calls out two relevant exceptions:

- Compressor contains GPLv3 CTAGDRC/LookAhead code and is excluded from the
  commercial license;
- Neural Amp/Tone3000 depends on a third-party service and per-model licenses.

See the
[official SDK licensing table](https://github.com/andremichelle/openDAW/blob/16f065a258fdbc27ffcb208e928f958339a1610f/packages/studio/sdk/README.md#L47-L80).
Before copying current device source or shipping the full SDK, confirm which
license governs this deployed app and whether Compressor and Tone3000 remain in
scope.

## Suggested rollout if the current radio engine stays

1. Upgrade only `@opendaw/lib-dsp` to `0.0.88` and `@opendaw/lib-std` to
   `0.0.82`, then run the existing audio tests and a production build.
2. Complete parity for Stereo Tool, Tidal, Delay, and Compressor before adding
   more superficially similar controls under new names.
3. Add the self-contained radio-friendly gaps: Cheap Reverb, Gate,
   Waveshaper, and Maximizer.
4. Add Autotune, then Vocoder, after the live-input/sidechain UX is decided.
5. Treat FX Composite, Stereo Split, and Frequency Split as one nested-routing
   project with a persisted-data migration.
6. Defer Werkstatt and Tone3000 until script trust, model distribution, service
   terms, and licensing have explicit product answers.

If instead the decision is to consume every official device and keep following
upstream, replace this rollout with a focused SDK/WASM proof of concept:
one radio deck, one Dattorro effect, saved parameter round-trip, production
asset loading, and WASM failure recovery. That spike should precede any UI-wide
migration.
