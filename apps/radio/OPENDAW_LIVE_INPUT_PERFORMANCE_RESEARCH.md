# openDAW live-input performance research

Research date: 2026-08-27

## Scope and versions

This report compares Radio with upstream openDAW at commit [`2588853288d300063a3691b8d7cb2bcf1240bbc3`](https://github.com/andremichelle/openDAW/tree/2588853288d300063a3691b8d7cb2bcf1240bbc3), the tip of `main` inspected on the research date. That commit publishes `@opendaw/studio-core` 0.2.4. Radio currently declares `@opendaw/studio-core ^0.2.3`; the installed 0.2.3 package identifies source commit [`e1495bbd78b89e262bcd72141dde0344bc328326`](https://github.com/andremichelle/openDAW/tree/e1495bbd78b89e262bcd72141dde0344bc328326). The live-input routing and telemetry discussed below are present in both revisions.

The comparison uses openDAW source, package exports, Web Audio and Media Capture specifications, and Chromium source. It does not use listening judgments. Exact microphone-to-speaker latency still requires an automated physical loopback measurement; browser counters can quantify output latency, underruns, render cost, and reported input settings without pretending those values are the same as end-to-end latency.

## Implementation status

The baseline comparisons below describe Radio before the accompanying implementation. Radio now uses openDAW's numeric-zero context policy, keeps single-channel capture and same-channel device selections mono through the effects boundary, reconnects the effects graph when a selection changes its logical width, and exposes the engine timing ring, CPU load, native playback statistics, selected track settings, live track state, and graph topology. Pixel 9 validation remains a numbers-only follow-up; no listening result is claimed here.

## Conclusion

Radio already adopted the most important openDAW performance feature: supported effects for all sources share one openDAW engine worklet through `Engine.registerMonitoringSource`. It should make that route the measured default for live input and should not recreate openDAW's internal monitoring router.

The first likely mobile regression identified in the baseline was outside openDAW. Radio created its singleton context with `latencyHint: "playback"`, while openDAW used `latencyHint: 0`. The implementation now uses numeric `0`. The Web Audio specification defines `"playback"` as prioritizing uninterrupted playback over latency and `"interactive"` as the lowest latency the user agent can provide without glitches. The selected context policy is fixed when `playDeviceSound` starts because Radio initializes the context before requesting the input stream.

The second baseline mismatch was input width. Radio requested up to 32 ideal input channels and sent every official monitoring source to openDAW as stereo. The implementation now requests two ideal channels by default, treats either a single-channel capture or the same device channel selected for both sides as mono, and registers that logical width. When an active selection changes between mono and stereo, Radio reconnects the effects graph so openDAW receives the new width. Explicit mono capture remains worth benchmarking because it reduces graph width and lets the eight-channel openDAW monitoring pool hold eight mono inputs instead of four stereo inputs.

The recommended direction is:

1. Use the adopted numeric `0` context policy as the benchmark baseline, with `"interactive"` and the former `"playback"` policy as comparison cases.
2. Use the implemented one-or-two-channel effects path as the baseline, then compare explicit mono and stereo capture on the target device.
3. Collect the performance counters now exposed by `OfficialOpenDawRuntime` and native `AudioContext.playbackStats` when available.
4. Benchmark bypass, pooled official effects, and compatibility effects independently. Keep the compatibility processor only for the three Radio-only types: `pitchShifter`, `distortion`, and `limiter`.
5. Select a policy from repeated numeric runs on the Pixel 9. Do not add a guessed buffer size or a second effects engine before these measurements identify the failing layer.

## How current openDAW handles a live input

### Context policy

The openDAW application asks for 48 kHz except on Firefox and constructs its realtime context with [`new AudioContext({sampleRate, latencyHint: 0})`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/app/studio/src/boot.ts#L80-L84). This is application policy, not a helper exported by `@opendaw/studio-core`.

The browser remains responsible for choosing the actual rendering configuration. The Web Audio specification says a numeric hint is expressed in seconds, may be rounded or ignored, and the selected processing latency is exposed through [`baseLatency`](https://webaudio.github.io/web-audio-api/#dom-audiocontext-baselatency). It defines [`"interactive"`](https://webaudio.github.io/web-audio-api/#dom-audiocontextlatencycategory-interactive) as the lowest possible latency without glitches and [`"playback"`](https://webaudio.github.io/web-audio-api/#dom-audiocontextlatencycategory-playback) as allowing increased latency to avoid interruption. Therefore `latencyHint: 0` is a request to minimize latency, not a zero-latency guarantee.

### Capture constraints

[`CaptureAudio`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/capture/CaptureAudio.ts#L241-L300) does the following:

- Requests `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false`.
- Requests `channelCount: {ideal: 1 | 2}`, defaulting to two.
- Does not constrain Media Capture `sampleRate` or `latency`.
- Uses an exact device ID when one is selected, then retries the default input without that constraint if the device disappeared.
- Reads the selected track settings, caps the effective stream width at two, and makes the downstream gain node's channel count explicit.

Its public [`AudioDevices.requestStream`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/AudioDevices.ts#L14-L25) is a small `getUserMedia` wrapper that normalizes errors and refreshes openDAW's input list. It does not itself improve latency.

The Media Capture specification defines [`latency`](https://www.w3.org/TR/mediacapture-streams/#def-constraint-latency) as a constrainable input property. A constraint is a request used by the browser's selection algorithm, while `MediaStreamTrack.getSettings()` returns the selected settings. openDAW's choice not to constrain latency leaves the browser free to optimize the capture device. Radio can still test `latency: {ideal: 0}` as a separate experiment, but that would be a Radio experiment, not adoption of current openDAW behavior.

### Direct and effects monitoring

openDAW exposes `MonitoringMode` as [`"off" | "direct" | "effects"`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/capture/MonitoringMode.ts#L1). [`CaptureAudio.#connectMonitoring`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/capture/CaptureAudio.ts#L317-L347) routes the modes differently:

- `direct`: media source to monitor gain and panner to destination. The engine effect chain is bypassed.
- `effects`: media source to `project.engine.registerMonitoringSource(...)`; the engine return then reaches the monitor gain, panner, and destination.
- `off`: no monitor connection.

The recording branch is separate. A prepared recording worklet receives the record gain node, so monitoring mode does not need to alter capture. openDAW's [`InputLatency.resolve`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/capture/InputLatency.ts#L1-L16) is recording-position compensation. It does not reduce live monitoring delay.

### One pooled effects worklet

The public [`Engine` interface](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/Engine.ts#L6-L46) accepts one or two channels per live source through `registerMonitoringSource` and removes it through `unregisterMonitoringSource`.

Internally, [`MonitoringRouter`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/MonitoringRouter.ts#L4-L88) merges all monitored source channels into one engine worklet input. The second worklet output carries up to eight processed monitoring channels, which the router splits back to each destination. Mono returns are duplicated to stereo. The eight-channel limit means four stereo sources or eight mono sources.

The engine worklet has [one input and two outputs](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/EngineWorklet.ts#L86-L124). Its WASM processor stages live input into engine memory, calls `engine.render()`, and copies both the main and monitoring returns in the same [128-frame render quantum](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core-wasm/src/processor.ts#L319-L375). At 48 kHz, one quantum is 2.667 ms. This quantum is only one part of total input-to-output latency.

### Performance facilities

The public engine exposes `cpuLoad`, `perfBuffer`, `perfIndex`, and `preferences`. [`EngineWorklet`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/EngineWorklet.ts#L321-L342) compares measured render time with the `128 / sampleRate` quantum budget. Detailed per-quantum timings are populated only while `engine.preferences.settings.debug.dspLoadMeasurement` is enabled in the [WASM processor](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core-wasm/src/processor.ts#L164-L179). openDAW's UI treats load below 75 percent as green, 75 to under 100 percent as warning, and 100 percent or more as overload in [`PerformanceStats`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/app/studio/src/ui/header/PerformanceStats.tsx#L21-L89).

openDAW also feature-detects [`AudioContext.playbackStats`](https://webaudio.github.io/web-audio-api/#dom-audiocontext-playbackstats) and installs its public [`BufferUnderrunDetector`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/BufferUnderrunDetector.ts#L6-L51). The detector polls the native `underrunEvents` counter once per second. After ten consecutive increases it can sleep the engine, depending on a studio preference. Chromium [enabled `AudioPlaybackStats` by default](https://chromium.googlesource.com/chromium/src/+/e7b216512e4f5caeaa22721bfc3df2946757aa5c) in February 2026, but Radio should still feature-detect it.

For measurement, direct sampling of `playbackStats` is more useful than adopting `BufferUnderrunDetector`: the native object reports underrun event count, underrun duration, total playback duration, and average, minimum, and maximum output latency, while the openDAW detector intentionally turns those numbers into an engine-stop policy.

## What Radio already adopts

Radio's [`OfficialOpenDawRuntime`](./src/lib/audio/manager/official-opendaw-runtime.ts#L214-L286) already installs `WasmEngine`, creates openDAW `AudioWorklets`, creates one `Project`, starts its engine worklet, waits for readiness, and starts the engine. It disconnects the normal master output because Radio consumes per-source monitor returns.

For each supported effects source, Radio creates an openDAW audio unit and calls the public [`project.engine.registerMonitoringSource`](./src/lib/audio/manager/official-opendaw-runtime.ts#L401-L475). All those sources use the same project and engine worklet. This is the upstream pooled architecture, not a Radio copy.

Radio's [`EffectsController`](./src/lib/audio/manager/effects-controller.ts#L592-L615) chooses:

- native bypass when no enabled processing is needed;
- the shared official openDAW runtime when every enabled effect is supported;
- the compatibility runtime otherwise.

The official mapping contains 19 openDAW effect types in [`official-opendaw-mapping.ts`](./src/lib/audio/dsp/effects/official-opendaw-mapping.ts#L3-L26). The only Radio-only types are [`pitchShifter`, `distortion`, and `limiter`](./src/lib/audio/dsp/effects/types.ts#L43-L47). A Radio-only effect anywhere in a nested chain keeps the complete source on compatibility processing, so one unsupported effect currently forfeits pooled processing for that source.

The compatibility backend creates one two-input stereo [`cacophony-processor` worklet per source](./src/lib/audio/playback/worklet-manager.ts#L563-L587). Radio also creates lazy per-source and master openDAW meter worklets while UI listeners exist in [`MeterService`](./src/lib/audio/manager/meter-service.ts#L44-L48) and [`MeterService.activate`](./src/lib/audio/manager/meter-service.ts#L157-L190). These worklets may be inexpensive, but their cost must be included in a mobile benchmark instead of assumed away.

## Public openDAW features Radio can adopt directly

| API or feature | Export and support status | Current Radio state | Recommendation |
| --- | --- | --- | --- |
| `Project`, `AudioWorklets`, `WasmEngine` | Public package APIs. `Project` and `AudioWorklets` are root exports of `@opendaw/studio-core`; `WasmEngine` is supplied by `@opendaw/studio-core-wasm`. | Already adopted by `OfficialOpenDawRuntime`. | Keep one project and one realtime engine per `AudioContext`. Do not create an engine per live source. |
| `Engine.registerMonitoringSource` and `unregisterMonitoringSource` | Public, root-exported `Engine` methods with explicit `1 | 2` channel support. | Already adopted. Device inputs pass the logical output width derived from capture and channel selection; active width changes reconnect the effects graph. Playback sources default to stereo. | Keep passing the effective width and make this the default effects route on supported devices. |
| `Engine.cpuLoad`, `perfBuffer`, `perfIndex`, and `preferences` | Public members of the root-exported `Engine` interface. | Exposed through a narrow read-only performance snapshot. | During benchmark runs, enable `dspLoadMeasurement`, snapshot the ring buffer and CPU load, then disable it. |
| `AudioDevices.requestStream` | Public root export. It wraps `getUserMedia`, error reporting, and openDAW's device list. | Radio uses `getUserMedia` directly. | Optional adoption for shared permission and device enumeration behavior. It provides no direct latency improvement and does not replace Radio's channel-routing lifecycle. |
| `CaptureAudio` and `MonitoringMode` | Public through the package root's `capture` exports. | Not used. | Do not adopt `CaptureAudio` just for a DJ deck. It is coupled to openDAW capture boxes, project recording, timeline state, and sample services. Adopt it only if Radio moves the complete input and recording lifecycle into an openDAW project. |
| `MeterWorklet` through `AudioWorklets.createMeter` | Public root exports. | Already adopted lazily by `MeterService`. | Keep it, but benchmark meters enabled and disabled. Avoid adding diagnostic meters when engine and playback counters answer the question. |
| `BufferUnderrunDetector` | Public root export. It requires an `AudioPlaybackStats` object and concrete `EngineFacade`. | Not used. | Do not use it as the benchmark collector because it implements a stop-on-overload policy. Consider it later only if Radio wants the same recovery behavior. |
| `MonitoringRouter` | Present in source and build output, but absent from the package root and absent from the package `exports` map. Direct subpath import is unsupported. | Its behavior is already reached through `Engine.registerMonitoringSource`. | Do not import, copy, or fork it. Use the public engine methods. |
| Engine WASM processor and performance ring implementation | Internal processor implementation, loaded as an openDAW worklet asset. | Already loaded by the official runtime. | Do not modify or duplicate it in Radio. Consume the engine's public telemetry. |

The package root export evidence is [`packages/studio/core/src/index.ts`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/index.ts#L1-L40) and [`capture/index.ts`](https://github.com/andremichelle/openDAW/blob/2588853288d300063a3691b8d7cb2bcf1240bbc3/packages/studio/core/src/capture/index.ts#L1-L8). Radio's installed package exposes only its root plus named worker and processor entry points, so an emitted file that is not in that export map is not a supported import.

## Material differences found in the baseline

### The context asked for playback latency

At the inspected baseline, Radio's singleton `createContext` used `latencyHint: "playback"`. The current [`getAudioContextOptions`](./src/lib/audio/playback/audio-context.ts#L20-L26) returns `latencyHint: 0`. [`playDeviceSound`](./src/lib/audio/manager/audio-manager.ts#L370-L420) still calls `init()` before starting the device source, so the microphone cannot select a different context policy later.

There is no standards-based API for changing an existing context's latency category. A/B runs still need a benchmark policy selected before initialization, with a fresh context or page reload between cases.

### Capture requested unnecessary width

At the inspected baseline, Radio disabled capture processing and requested 48 kHz, but defaulted to `channelCount: {ideal: 32}`. The graph treated the result as at most stereo and the official runtime registered every source with two channels. The current [`DeviceSource.start`](./src/lib/audio/playback/device-source.ts#L370-L431) defaults to `channelCount: {ideal: 2}`, snapshots the selected track settings, and initializes channel routing. Its [`outputChannelCount` and routing](./src/lib/audio/playback/device-source.ts#L182-L274) keep a one-channel capture or same-channel selection mono. The [audio graph](./src/lib/audio/manager/audio-manager-graph.ts#L113-L211) passes that logical width to the runtime and reconnects an active input when a selection changes between mono and stereo.

Radio now records the requested constraints, selected track settings, and track label. [`DeviceSource.getDiagnostics`](./src/lib/audio/playback/device-source.ts#L155-L166) also reads `muted` and `readyState` from the current track, while [`stop`](./src/lib/audio/playback/device-source.ts#L484-L507) clears the diagnostics. Benchmark records should retain `channelCount`, `sampleRate`, `latency`, `echoCancellation`, `noiseSuppression`, `autoGainControl`, `deviceId`, the label, and the live track state. A requested constraint without the selected setting is not evidence that the browser honored it.

### Unsupported effects change the whole execution model

The native graph is [`source -> pan -> filter -> effects router -> pre-fader send -> gain -> output`](./src/lib/audio/manager/audio-manager-graph.ts#L128-L160) for playback sources; device inputs place pan after effects to preserve mono input width. Supported chains take the pooled official path. Adding one Radio-only effect moves the source to its own compatibility worklet. Mobile results therefore need to name the active backend and effect chain. An aggregate "effects on" result would mix two different engines and conceal the likely cause of crackles.

For unsupported effects, the efficient long-term choices are:

1. Keep their custom implementations isolated in compatibility processing and optimize from measured per-effect cost.
2. Port a Radio-only algorithm into a supported openDAW extension mechanism, such as a Werkstatt processor, if it can preserve the product's parameter and sound contract. This keeps the source on the pooled engine but requires deterministic parity and latency tests.
3. Build a hybrid graph that crosses between openDAW and custom processing only for unsupported nodes. This can save compatibility CPU for mixed chains, but every extra worklet boundary can add scheduling risk and at least one render-quantum opportunity for delay. It should be attempted only after measurements show a mixed chain is a common bottleneck.

Option 1 is the lowest-risk first step. Option 2 is preferable when an algorithm maps cleanly to an openDAW-supported device. Option 3 has the highest routing and synchronization cost.

## Numeric experiment design

Use the same Pixel 9, Chrome build, physical input and output route, input signal, graph, effect presets, UI state, and run length for all cases. Reload or recreate the context between context-policy cases. Use a 5-second warm-up followed by at least 60 seconds of collection and repeat each cell at least five times. Report every run, median, and worst case rather than only the best result.

### Independent variables

| Dimension | Cases |
| --- | --- |
| Context policy | current numeric `0`; `"interactive"`; former `"playback"` baseline |
| Capture width | mono `{ideal: 1}`; stereo `{ideal: 2}` |
| Capture latency constraint | omitted, matching openDAW; `{ideal: 0}` only as a separate Radio experiment |
| Processing route | native bypass; official pooled engine; compatibility engine |
| Effect load | no effects; one representative light effect; one representative heavy effect; the failing real chain |
| Source count | one live input; expected maximum concurrent live and playback sources |
| Meter load | UI meters subscribed; meters unsubscribed |

Do not combine dimensions until the first single-variable runs establish the main effect. A useful order is context policy, capture width, route, effect count, source count, then meters.

### Measurements

Collect one structured record per run:

| Metric | Source | Interpretation |
| --- | --- | --- |
| `underrunEvents` delta | `context.playbackStats`, feature-detected | Primary crackle/dropout counter for the output path. Lower is better; zero is the target. |
| `underrunDuration / totalDuration` delta | `context.playbackStats` | Fraction of output time lost to underruns. Report both raw durations and ratio. |
| average, minimum, maximum playback latency | `context.playbackStats` | Measured output-device path latency statistics. These exclude capture latency. |
| `baseLatency` and `outputLatency` | `AudioContext` | Browser-reported graph and output estimates. Record after the context is running. |
| Selected input settings | `track.getSettings()` | Confirms actual channel count, sample rate, latency setting, and audio processing state. |
| Engine render time | `engine.perfBuffer` and `perfIndex` | Official openDAW DSP time for each sampled quantum while measurement is enabled. Derive mean, p95, p99, and maximum as percentages of `128 / sampleRate`. |
| Engine peak load | `engine.cpuLoad` | openDAW's once-per-second peak render load summary. |
| Backend and worklet count | Radio runtime state plus instrumentation | Separates official pooled, compatibility, meter, and recording worklets. |
| Effect algorithmic delay | deterministic `OfflineAudioContext` impulse test | First significant output frame minus input impulse frame for every effect and representative chain. This is stable and does not depend on a phone's scheduler. |

The implemented [`OfficialOpenDawRuntime` snapshot](./src/lib/audio/manager/official-opendaw-runtime.ts#L157-L196) keeps its `Project` private and returns copied timing values, current load, the quantum budget, and registered monitoring channel count. The context snapshot supplies the sample rate. Copying the ring data prevents later worklet updates from mutating a stored result.

### Acceptance rules

Use these as initial decision rules, not universal browser promises:

- Required: zero additional underrun events during each 60-second steady-state run.
- Required: zero measured underrun-duration delta.
- Official engine: p99 render cost below 75 percent of the quantum budget and no sample at or above 100 percent. The 75 percent boundary matches openDAW's own warning threshold.
- Input: actual mono for the microphone case unless stereo is explicitly selected.
- Latency: choose the lowest median reported output latency among cases that pass the underrun rules. A lower-latency case that crackles is not a pass.
- Effects: publish results separately for official and compatibility backends. A supported-effect chain should not silently fall back during a run.

CI should test option propagation, backend selection, metric-delta arithmetic, telemetry snapshot shape, and deterministic effect delay. It should not fail on wall-clock DSP thresholds from a shared desktop runner. Phone performance runs should produce an artifact that can be compared numerically across revisions.

## What the numbers can and cannot prove

`AudioPlaybackStats.averageLatency` measures the destination and output path. `MediaTrackSettings.latency` is the selected input setting reported by the capture track. Adding those numbers to `baseLatency` can produce a useful reported pipeline estimate, but it is not an end-to-end measurement because the values have different definitions and may not cover every platform buffer.

For exact microphone-to-speaker latency, use a physical loopback fixture and automated cross-correlation: emit a known pulse or maximum-length sequence into the input, record the device output, and calculate the sample offset. Repeat for bypass, official effects, and compatibility effects. This remains a numbers-only test and detects both buffering and algorithmic delay. Without a loopback, describe latency results as browser-reported output latency plus reported input settings, not "near zero end-to-end latency."

## Recommended follow-up sequence

1. Use the implemented structured diagnostics to capture native playback stats, context latency, complete selected track settings, live track state, backend counts, source and channel counts, and meter state.
2. Enable the implemented `OfficialOpenDawRuntime` timing snapshot during each run and retain deterministic tests for its calculations.
3. Add a benchmark-only context-creation policy seam and A/B the current numeric `0` against `"interactive"` and the former `"playback"` baseline on the Pixel 9. Keep numeric `0` as the product default until the results justify another change.
4. Compare explicit mono and stereo capture, plus a same-channel logical mono selection, through the implemented one-or-two-channel effects boundary. Verify on the Pixel 9 that the browser selects the requested capture width, Radio registers a same-channel selection as mono, and mono returns as stereo monitoring as openDAW specifies.
5. Run the full matrix for bypass and official effects. If official effects pass but compatibility fails, profile `pitchShifter`, `distortion`, and `limiter` independently and decide whether to optimize or port each one.
6. Measure meters on and off. Change meter behavior only if the delta is material.
7. Add an automated physical loopback run only if product acceptance requires a defensible end-to-end latency number.

This sequence adopts openDAW where it has stable public features, keeps Radio-specific code only where its DJ lifecycle or unsupported effects require it, and provides a numeric basis for every buffer and routing decision.
