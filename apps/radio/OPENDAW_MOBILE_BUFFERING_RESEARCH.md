# openDAW mobile microphone and Autotune buffering research

Research date: 2026-08-27

Upstream snapshot: openDAW commit [`0e24072db43fb1831523041f78311243f5b060ed`](https://github.com/andremichelle/openDAW/commit/0e24072db43fb1831523041f78311243f5b060ed), the current `main` commit when this report was prepared.

## Conclusion

openDAW does not assign a small buffer to dry input and a large buffer to effected input. It creates one `AudioContext` with `latencyHint: 0`, processes the engine in fixed 128-frame quanta, and solves the dry-monitoring case with a separate graph route:

- Direct monitoring bypasses the engine and effect chain.
- Effects monitoring enters the one openDAW worklet and returns from its monitor output.
- Both routes still share the same `AudioContext`, output device, and browser-selected system buffer.

The microphone and Autotune symptoms therefore have related but different causes:

- Dry latency includes microphone capture, browser media buffering, `AudioContext` output buffering, and hardware latency. openDAW minimizes graph work by bypassing the worklet.
- Autotune adds a hard 1,280-sample PSOLA lookahead, 26.7 ms at 48 kHz, and bursty DSP work. Its YIN detector performs 192,000 squared-difference iterations in one detector frame every 256 native samples, which is every second 128-frame Web Audio quantum. Those bursts are a credible source of mobile deadline misses and crackle.

A larger browser output buffer can give bursty processing more scheduling tolerance if the browser honors the hint, but that larger buffer affects the dry route too. A buffer inserted inside the graph does not give the current worklet callback more time. The durable solution is to keep the openDAW-style dry bypass and reduce or spread Autotune's worst-case DSP work. Until that is available, select one sustainable context profile per device at context creation and use an explicit fallback when the official Autotune path still underruns.

## Installed, published, and current upstream versions

Radio declares the openDAW dependencies in [`apps/radio/package.json`](./package.json#L29-L35). The versions below were read from the installed package metadata and the npm registry on 2026-08-27.

| Package | Installed | Latest published | Latest git commit |
| --- | ---: | ---: | --- |
| `@opendaw/lib-dsp` | `0.0.91` | `0.0.92` | `b0c31f349354ad6ecbc5d4724b041eaae9181251` |
| `@opendaw/studio-adapters` | `0.3.1` | `0.3.2` | `b0c31f349354ad6ecbc5d4724b041eaae9181251` |
| `@opendaw/studio-boxes` | `0.0.107` | `0.0.108` | `b0c31f349354ad6ecbc5d4724b041eaae9181251` |
| `@opendaw/studio-core` | `0.2.3` | `0.2.4` | `b0c31f349354ad6ecbc5d4724b041eaae9181251` |
| `@opendaw/studio-core-wasm` | `0.0.14` | `0.0.15` | `b0c31f349354ad6ecbc5d4724b041eaae9181251` |

Registry metadata: [`lib-dsp`](https://registry.npmjs.org/@opendaw%2Flib-dsp/latest), [`studio-adapters`](https://registry.npmjs.org/@opendaw%2Fstudio-adapters/latest), [`studio-boxes`](https://registry.npmjs.org/@opendaw%2Fstudio-boxes/latest), [`studio-core`](https://registry.npmjs.org/@opendaw%2Fstudio-core/latest), and [`studio-core-wasm`](https://registry.npmjs.org/@opendaw%2Fstudio-core-wasm/latest).

The four installed studio packages came from commit `e1495bbd78b89e262bcd72141dde0344bc328326`. Reviewing the [installed-to-latest comparison](https://github.com/andremichelle/openDAW/compare/e1495bbd78b89e262bcd72141dde0344bc328326...b0c31f349354ad6ecbc5d4724b041eaae9181251) found no buffering or Autotune performance fix:

- `CaptureAudio.ts`, `MonitoringRouter.ts`, `autotune.rs`, `psola.rs`, and `docs/autotune.md` are unchanged.
- The Autotune device change only adds the new modulation argument to the general parameter ABI.
- The worklet changes concern command plumbing, not its render path or buffer policy.
- Studio boot gained retryable `AudioContext.resume()` handling. Its `sampleRate` and `latencyHint` policy did not change.
- The performance page gained Convolver cases, but still does not benchmark Autotune.

Current `main` also retains the same context policy, monitor routing, detector, and shifter. Upgrading the packages is sensible maintenance, but it is not a fix for this issue.

## What openDAW does

### One low-latency context

Production openDAW creates one context at 48 kHz except on Firefox and passes numeric zero as the latency hint: [`packages/app/studio/src/boot.ts`, lines 81-86](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/app/studio/src/boot.ts#L81-L86).

```ts
const sampleRate = Browser.isFirefox() ? undefined : 48000
const context = new AudioContext({sampleRate, latencyHint: 0})
```

The Web Audio specification defines `latencyHint` as a constructor option. A numeric value requests seconds of latency, but the browser may interpret it at its discretion; `baseLatency` reports the result. The named `interactive` profile asks for the lowest output latency possible without glitching, while `balanced` trades latency against power and `playback` prioritizes uninterrupted playback. See [the latency categories](https://webaudio.github.io/web-audio-api/#enumdef-audiocontextlatencycategory) and [`AudioContextOptions.latencyHint`](https://webaudio.github.io/web-audio-api/#dom-audiocontextoptions-latencyhint).

Two consequences matter here:

1. The hint cannot be changed on the existing context. A different profile requires rebuilding the audio runtime around a new context, normally through a controlled reload.
2. The actual result must be measured. `0`, `"interactive"`, and a numeric value can map to the same or different device buffers depending on the browser.

The spec also warns that `AudioContext` objects are expensive, may create high-priority threads and low-latency system streams, and may be limited by the browser. It says more than one context is usually unnecessary. Two simultaneous contexts for dry and effected audio are therefore a poor default, especially on mobile: [Web Audio system resources](https://webaudio.github.io/web-audio-api/#system-resources-associated-with-baseaudiocontext-subclasses).

### Direct monitoring is a route, not a second buffer

openDAW exposes exactly three monitoring modes, `off`, `direct`, and `effects`: [`MonitoringMode.ts`, line 1](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/capture/MonitoringMode.ts#L1).

In `direct` mode the `MediaStreamAudioSourceNode` connects to the monitor gain and destination. In `effects` mode it is registered with the engine: [`CaptureAudio.ts`, lines 317-347](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/capture/CaptureAudio.ts#L317-L347). The recording manual describes Direct as the lowest-latency raw route and Effects as the full track chain: [`recording.md`, lines 29-36](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/app/studio/public/manuals/recording.md#L29-L36).

For Effects monitoring, `MonitoringRouter` merges at most eight live input channels into the single engine worklet and splits its second output back to the monitored units: [`MonitoringRouter.ts`, lines 23-88](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/MonitoringRouter.ts#L23-L88). The WASM processor stages those channels, calls `engine.render()`, and copies the returned monitor channels in the same callback: [`core-wasm/src/processor.ts`, lines 318-370](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core-wasm/src/processor.ts#L318-L370).

Radio follows the same broad routing shape. Its bypass path is source to gain to destination in [`effects-backend-router.ts`, lines 39-52](./src/lib/audio/manager/effects-backend-router.ts#L39-L52), and the official path registers the live source with the openDAW engine in [`official-opendaw-runtime.ts`, lines 476-481](./src/lib/audio/manager/official-opendaw-runtime.ts#L476-L481). Radio now deliberately diverges from openDAW's context profile on mobile by requesting one 256-frame system-buffer window while retaining the engine's required 128-frame render quantum; browsers remain free to choose a different actual buffer.

### Fixed 128-frame engine quanta

openDAW fixes its render quantum at 128 frames in both TypeScript and Rust:

- [`packages/lib/dsp/src/constants.ts`, lines 3-4](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/lib/dsp/src/constants.ts#L3-L4)
- [`crates/dsp/src/lib.rs`, lines 48-50](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/src/lib.rs#L48-L50)
- [`core-wasm/src/processor.ts`, lines 324-350](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core-wasm/src/processor.ts#L324-L350)

At 48 kHz one quantum represents 2.667 ms. This is the engine's processing chunk, not necessarily the device's system callback buffer. The Web Audio 1.1 editor's draft distinguishes the render quantum from the system callback and notes that callback and quantum sizes need not match: [rendering an audio graph](https://webaudio.github.io/web-audio-api/#rendering-an-audio-graph).

The same draft adds a constructor-only `renderSizeHint`, but it is only a hint and 128 remains the default: [`renderSizeHint`](https://webaudio.github.io/web-audio-api/#dom-audiocontextoptions-rendersizehint). openDAW does not pass it and its TypeScript, Rust, scratch buffers, and WASM staging all assume 128. Requesting a different quantum in Radio would violate the installed engine contract. It should not be used without an upstream variable-quantum implementation and browser support validation.

### Capture constraints do not request input latency

openDAW disables echo cancellation, noise suppression, and automatic gain control, requests one or two channels, and selects the device. It does not request capture `latency` or `sampleRate`: [`CaptureAudio.ts`, lines 241-300](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/capture/CaptureAudio.ts#L241-L300). `AudioDevices.requestStream` passes those constraints directly to `getUserMedia`: [`AudioDevices.ts`, lines 14-25](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/AudioDevices.ts#L14-L25).

The Media Capture specification defines `latency` as the time from real-world processing start until data is available to the next step. It is a target whose actual value may vary, and higher latency can help power use: [the official `latency` constraint](https://www.w3.org/TR/mediacapture-streams/#def-constraint-latency). An experiment with `latency: {ideal: 0}` is valid for Radio's dry path, but it is not current openDAW behavior and browsers may ignore it. Always record `track.getSettings().latency`, `sampleRate`, and `channelCount` rather than treating the request as the result.

Forcing a context to 48 kHz can also incur output resampling when the device is native at a different rate. The Web Audio constructor requires that resampling and warns that latency may be affected substantially: [`AudioContext` construction, steps 11.3-11.4](https://webaudio.github.io/web-audio-api/#dom-audiocontext-audiocontext). Since 48 kHz is openDAW's production choice, native-rate versus forced-48-kHz should be a measured mobile experiment rather than an assumed improvement.

## Which buffer controls which symptom

| Layer | Controlled by | Applies to | What changing it can do |
| --- | --- | --- | --- |
| Microphone capture buffering | Browser and OS, optionally the `getUserMedia` `latency` target | Dry and effected input | Can reduce or increase time before samples reach Web Audio. It does not increase the engine's processing budget. |
| Web Audio render quantum | Browser constructor `renderSizeHint` in the 1.1 draft | Every graph route in that context | Changes callback block shape. openDAW currently requires 128 and cannot safely use another value. |
| System output/callback buffering | Browser and OS, influenced by `latencyHint` | Every route to the context destination | More buffering may tolerate bursty CPU load, but adds dry and effected output latency. The browser may ignore the request. |
| In-graph delay or ring buffer | Application graph or effect code | Only the path containing it | Delays audio but does not extend the deadline of the current worklet callback. It cannot repair a callback that already missed its deadline. |
| Autotune algorithm lookahead | openDAW PSOLA code | Autotune only | Adds 1,280 samples of unavoidable signal-path latency in the current algorithm. Browser buffer settings do not remove it. |

`baseLatency` covers processing from the destination to the audio subsystem and excludes latency added by the graph. `outputLatency` covers output-device presentation latency. Neither includes Autotune's PSOLA delay, and Web Audio explicitly notes that media stream source nodes may add internal buffers: [Web Audio latency attributes](https://webaudio.github.io/web-audio-api/#dom-audiocontext-baselatency) and [latency considerations](https://webaudio.github.io/web-audio-api/#latency-section).

## Why Autotune is a special mobile load

openDAW's current Autotune is the quality-focused Rust/WASM path. It uses one YIN detector and one TD-PSOLA shifter; the earlier phase-vocoder alternative was removed: [`docs/autotune.md`, lines 35-48](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/docs/autotune.md#L35-L48). The implementation was added in [commit `0106cf8`](https://github.com/andremichelle/openDAW/commit/0106cf80dec3610d18dd13272a0f3a5e7d5378a4) and its last detector behavior change was [commit `94c4cd0`](https://github.com/andremichelle/openDAW/commit/94c4cd0ed2bebd8851b3cf2dcf82cf77a21c328c).

### Detector burst

The detector decimates the mono input 2:1, uses a 640-sample analysis window, checks 300 candidate lags, and runs a frame every 128 decimated samples: [`autotune.rs`, lines 13-23](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/src/autotune.rs#L13-L23) and [`docs/autotune.md`, lines 153-175](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/docs/autotune.md#L153-L175).

The code invokes the complete detector frame when the hop becomes due, then nests all 300 lag candidates over all 640 window samples: [`autotune.rs`, lines 330-362](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/src/autotune.rs#L330-L362). From those constants and loops:

- One detector frame performs `300 * 640 = 192,000` squared-difference iterations, plus energy, CMNDF, and candidate scans.
- A frame is due every 128 decimated samples, or every 256 native samples.
- With 128-frame engine quanta, the large detector frame lands every second worklet quantum after the input ring has filled.

This is a source-derived inference, not an upstream benchmark result. It predicts an alternating high-cost and low-cost pattern that should be visible by grouping Radio's quantum timings by index parity.

### PSOLA lookahead and correlation bursts

PSOLA fixes its output lookahead at `2 * MAX_PERIOD = 1,280` samples: [`psola.rs`, lines 8-16](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/src/psola.rs#L8-L16). The official Autotune documentation identifies the same 26.7 ms delay at 48 kHz: [`docs/autotune.md`, lines 405-421](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/docs/autotune.md#L405-L421).

That 26.7 ms is hard signal-path latency before microphone and output buffers. The detector's documented 13 ms window-center latency affects how quickly correction reacts; it should not be added as another fixed audio delay in a steady-state loop.

PSOLA also refines analysis marks with a nested search over candidate lags and a period-length correlation: [`psola.rs`, lines 64-143](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/src/psola.rs#L64-L143). At the detector's 80 Hz floor, a 600-sample period gives about 301 lag candidates times 600 correlation samples, or about 180,600 inner iterations when a mark is refined. This is another source-derived estimate. Its frequency is pitch-dependent rather than once per quantum.

The device exposes musical controls only. It has no mobile, low-power, detector-quality, search-width, or buffer setting. `process_audio` always calls detector feed and PSOLA processing: [`device-autotune/src/lib.rs`, lines 30-43 and 75-113](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/stock-devices/device-autotune/src/lib.rs#L30-L113). Setting Amount to zero is therefore not a computational bypass.

### Existing overload detection can miss this pattern

openDAW measures worklet time against `128 / sampleRate` and triggers its CPU overload response only after 30 consecutive over-budget quanta: [`EngineWorklet.ts`, lines 325-345](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/EngineWorklet.ts#L325-L345). An every-other-quantum Autotune spike resets that consecutive counter on each cheaper intervening quantum. The UI's maximum load can still turn red, but this handler may never fire.

The separate `BufferUnderrunDetector` polls native `AudioPlaybackStats.underrunEvents` once per second and optionally stops playback after increases in ten consecutive polls. It does not resize or recreate the context: [`BufferUnderrunDetector.ts`, lines 6-51](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/studio/core/src/BufferUnderrunDetector.ts#L6-L51). openDAW's latency reporter likewise observes `outputLatency` every ten seconds and does not adapt it: [`LatencyReporter.ts`, lines 3-28](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/app/studio/src/LatencyReporter.ts#L3-L28).

The Web Audio specification names excessive real-time DSP work as a cause of clicks and pops: [audio glitching](https://webaudio.github.io/web-audio-api/#audio-glitching). The current openDAW performance page is not evidence that Autotune fits mobile deadlines. Its benchmark list omits Autotune: [`DeviceBenchmark.ts`, lines 1-149](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/packages/app/studio/src/perf/DeviceBenchmark.ts#L1-L149). The Autotune lab uses 128-frame blocks but evaluates pitch behavior rather than callback duration or tail latency: [`autotune_lab.rs`, lines 1-11](https://github.com/andremichelle/openDAW/blob/0e24072db43fb1831523041f78311243f5b060ed/crates/dsp/tests/autotune_lab.rs#L1-L11).

## Recommended direction

### 1. Preserve the dry bypass

Keep microphone-only monitoring out of the engine and all effect nodes. This matches openDAW's Direct mode and gives the browser the shortest graph path available. If the phone still has unacceptable dry latency, the remaining work is capture and device-profile measurement, not more worklet optimization.

For interfaces that provide hardware direct monitoring, that hardware path is the only way to bypass browser input and output buffering completely. It cannot include the web Autotune effect.

### 2. Choose one context profile per device session

Add a controlled mobile experiment that creates the entire audio runtime with one of these profiles before capture starts:

1. `{latencyHint: 0, sampleRate: 48000}`, the current openDAW profile.
2. `{latencyHint: "interactive", sampleRate: 48000}`, which asks the browser for its lowest non-glitching interactive profile.
3. `{latencyHint: "balanced", sampleRate: 48000}`.
4. Numeric `latencyHint` values such as `0.01` and `0.02` seconds.
5. The native output sample rate, as a separate experiment only when it differs from 48 kHz.

Each case needs a fresh context or page reload. Select the lowest-latency profile that records no actual underruns during the official Autotune test. Store the choice by device and browser version, with an easy reset. Do not assume that the requested value was honored.

This is a mitigation, not independent per-route buffering. If `balanced` or 20 ms is needed for Autotune, Direct monitoring in that context also receives the extra output latency.

### 3. Test the microphone latency target separately

For the dry case, test `latency: {ideal: 0}` in `getUserMedia`, then log the requested constraints and actual track settings. It may reduce capture latency on a browser that supports it. It cannot cure Autotune deadline misses and should not be tied to the effects buffer experiment.

### 4. Fix Autotune's tail cost

The highest-value upstream DSP change is to spread the YIN difference calculation instead of recomputing the complete 640 by 300 matrix in one callback. One conservative design is a rolling squared-difference sum per lag:

- For each decimated sample and each lag, subtract the pair leaving the 640-sample window and add the newest pair.
- Run CMNDF and pitch selection only on each 128-sample detector hop.
- Periodically rebuild the rolling sums to bound floating-point drift.
- Preserve the existing f64 rounding points and golden pitch fixtures, then add real-time p50, p95, p99, and maximum-duration tests.

The source constants imply about a fivefold reduction in average difference work: the current `640 * 300 / 128 = 1,500` difference iterations per decimated input sample versus about 300 rolling updates. More importantly, the work is spread across samples instead of arriving as one 192,000-iteration burst. This proposal needs quality and deterministic-parity validation before shipping.

PSOLA's correlation search should then be measured independently. If it remains the mobile tail, possible upstream options are incremental correlation, a narrower bounded search on a documented low-power mode, or a cheaper coarse-to-fine search. Those options trade implementation risk or phase-lock quality and should be driven by on-device timing data.

### 5. Fail over based on actual underruns

If the official effect still cannot meet deadlines on a supported phone, disable effected monitoring with a clear explanation. Do not silently substitute Radio's compatibility pitch shifter: it is a varispeed effect rather than a quality-equivalent Autotune implementation. Use real underrun deltas and sustained timing windows, not only openDAW's 30-consecutive-quantum signal. Amount zero is not a bypass.

## How to reproduce the phone failure faithfully

Desktop CPU throttling can reproduce compute pressure but not the phone's microphone driver, OS capture buffers, audio thread scheduling, thermal behavior, or output route. The deciding test must run on the affected phone with its real microphone and output.

For each fresh context profile:

1. Record 30 to 60 seconds of dry bypass with the same mono microphone and output route.
2. Record 30 to 60 seconds with only official openDAW Autotune enabled.
3. Repeat after the device is warm enough to expose thermal throttling.
4. Capture the actual context sample rate, `baseLatency`, `outputLatency`, and requested latency hint.
5. Capture `AudioPlaybackStats` deltas when available: `underrunEvents`, `underrunDuration`, average latency, minimum latency, and maximum latency. The draft updates these once per second: [`AudioPlaybackStats`](https://webaudio.github.io/web-audio-api/#audioplaybackstats). Feature-detect because this API is not universal.
6. Capture openDAW quantum durations from Radio's existing performance snapshot, including p50, p95, p99, maximum, and count over the 2.667 ms quantum duration. Also group timings by even and odd quantum index to test the predicted detector cadence. Radio exposes the raw samples and budget in [`official-opendaw-runtime.ts`, lines 175-196](./src/lib/audio/manager/official-opendaw-runtime.ts#L175-L196).
7. Capture `MediaStreamTrack.getSettings()`, especially `latency`, `sampleRate`, and `channelCount`.
8. Mark the exact browser version, phone model, power mode, Bluetooth or wired output route, and whether the screen was active.

An individual worklet quantum exceeding 2.667 ms is a useful warning, not final proof of a device underrun. A larger system callback can contain multiple 128-frame render quanta and tolerate an expensive quantum followed by a cheap one. The authoritative browser signal is the playback underrun delta; audible capture and a physical loopback are the fallback when it is unavailable.

For real end-to-end latency, use an analog loopback or acoustic impulse/chirp and cross-correlate recorded input with monitored output. Browser latency attributes exclude graph latency, so they cannot reveal the fixed PSOLA delay by themselves.

Suggested acceptance criteria:

- Dry route: the lowest measured round-trip latency among profiles with no audible glitches and no underrun increase.
- Official Autotune: no audible crackle and no underrun increase during a 60-second warm-device run.
- Performance telemetry: report the entire distribution and alternating cadence. Do not require every 128-frame quantum to finish within 2.667 ms when the browser uses a larger system callback, but treat repeated high tails as a portability risk.
- If no single context profile passes both dry latency and Autotune stability, stop increasing the shared buffer. Optimize or replace the Autotune path because one context cannot satisfy contradictory per-route buffer requirements.

## Approaches to avoid

- Do not add a `DelayNode` or application ring buffer after Autotune to cure crackle. It adds latency after the work and cannot repair a missed render deadline.
- Do not request a non-128 `renderSizeHint` with the current openDAW engine. The upstream contract and scratch layout are fixed at 128.
- Do not run dry and effected monitoring in separate live `AudioContext` instances by default. They are expensive, can be capped by the browser, and introduce unsynchronized clocks and lifecycle complexity.
- Do not increase microphone input latency to give Autotune more compute time. Capture latency delays when samples arrive but does not enlarge the worklet's output deadline.
- Do not rely on the openDAW overload handler alone. Alternating Autotune spikes can avoid its consecutive-overload threshold.
- Do not treat a dependency bump as this fix. The published and current upstream code retains the same relevant behavior.
