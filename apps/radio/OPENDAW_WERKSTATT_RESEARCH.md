# openDAW Werkstatt integration research

Research date: **2026-07-23** (Europe/Rome)

## Source snapshot

The radio currently installs these published packages:

- `@opendaw/studio-core@0.1.3`
- `@opendaw/studio-core-wasm@0.0.7`
- `@opendaw/studio-adapters@0.1.3`
- `@opendaw/studio-boxes@0.0.101`

Their package manifests all identify the published source commit as
[`a85f975`](https://github.com/andremichelle/openDAW/commit/a85f975d766647670ef37e4fcbe0f75901642e72);
see the installed manifests under
`apps/radio/node_modules/@opendaw/{studio-core,studio-core-wasm,studio-adapters,studio-boxes}/package.json`.

The current upstream head inspected during this research was
[`79a0353`](https://github.com/andremichelle/openDAW/commit/79a035334e00ef8cae694cb53a5c7d8d006ed3b3).
The Werkstatt manual, examples list, script compiler, declaration parser,
WASM script bridge, and Werkstatt Rust bridge have identical Git blob hashes
between the installed release commit and that current head. The published
snapshot is therefore the implementation source of truth below, while also
matching current upstream for the relevant files.

All conclusions below come from first-party source, published package output,
or the official manual. Inferences and radio-specific recommendations are
marked explicitly.

## Confirmed script contract

Werkstatt code is plain JavaScript evaluated in the audio worklet. It must
define a class named `Processor`; the compiler wraps the source and returns that
class as the registry entry's constructor
([compiler wrapper](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L119-L141)).
The official starter prompt disallows imports, modules, DOM, `fetch`, timers,
and allocation inside the render callback
([starter prompt](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/werkstatt-starter-prompt.txt#L1-L91)).

The complete effect shape is:

```js
class Processor {
  constructor() {
    // Optional. Allocate buffers and initialize state here.
  }

  paramChanged(label, value) {
    // Optional. Receives the mapped value for an @param declaration.
  }

  reset() {
    // Optional. Called when the engine resets the device.
  }

  process({ src, out }, block) {
    const [srcL, srcR] = src;
    const [outL, outR] = out;
    const { s0, s1, index, p0, p1, bpm, flags } = block;

    // The script must write both output channels for every index in [s0, s1).
  }
}
```

`src` and `out` contain left/right `Float32Array` views. `s0` is inclusive and
`s1` exclusive. The output is not a host-provided dry copy, so every script
must fully write both output buffers over that range. `sampleRate` is available
as a global. The block also supplies:

- `index`: render-block counter;
- `bpm`: current tempo;
- `p0`/`p1`: block position at 480 pulses per quarter note;
- `flags`: `1` transporting, `2` discontinuous, `4` playing, and `8` BPM
  changed.

These details are defined by the
[official API reference](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/public/manuals/devices/audio/werkstatt.md#L175-L212)
and exercised by the upstream
[WASM parity test](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/wasm/test/werkstatt-parity.test.ts#L14-L33).
The Rust device splits a render block at automation-change positions, forwards
the parameter update, and calls the script for each resulting subrange
([Werkstatt bridge](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/crates/stock-devices/device-werkstatt/src/lib.rs#L87-L123)).

### Source declarations

The current declaration grammar is:

```text
// @label <free-form device name>
// @group <single-token group name> [single-token color]
// @param <name> [default] [min max type [unit]]
// @sample <single-token label>
```

Supported parameter forms are:

| Source | Meaning |
| --- | --- |
| `// @param gain` | unipolar `0..1`, default `0` |
| `// @param gain 0.5` | unipolar `0..1`, default `0.5` |
| `// @param bypass false` | boolean, default off |
| `// @param bypass bool` | boolean, default off |
| `// @param bypass 1 bool` | boolean, default on |
| `// @param gain 1 0 2` | linear `0..2`, default `1` |
| `// @param cutoff 1000 20 20000 exp Hz` | exponential range with unit |
| `// @param mode 0 0 3 int` | integer range |

Full mappings are `linear`, `exp`, `int`, and `bool`; an omitted mapping is
unipolar. Defaults must be numeric and within their range. The maximum must be
greater than the minimum except for boolean declarations. Invalid numbers,
ranges, or mapping names throw explicit parser errors
([parser](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptDeclaration.ts#L55-L123),
[official parameter guide](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/public/manuals/devices/audio/werkstatt.md#L57-L113)).

`paramChanged` receives the mapped value, not a normalized value, for mapped
declarations. The official bridge applies the same `ValueMapping` as the normal
parameter adapter
([mapping implementation](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L78-L85),
[parameter delivery](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L249-L263)).

Groups are presentation metadata. A group begins at `@group` and contains the
following parameter/sample declarations until the next group. The official
colors are `blue`, `green`, `yellow`, `cream`, `orange`, `red`, `purple`,
`white`, `gray`, and `dark`
([group guide](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/public/manuals/devices/audio/werkstatt.md#L115-L158)).

Parameter and sample declarations share one declaration-order index. This is
the index used by the engine when forwarding dynamic values
([declaration ordering](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptDeclaration.ts#L161-L173)).
Duplicate labels should therefore be rejected by the radio editor: upstream
reconciliation ignores later duplicates while wrapper metadata can retain
them, making duplicate behavior ambiguous.

## Confirmed compilation and loading lifecycle

The persisted header is:

```text
// @werkstatt js 1 <monotonic-update>
```

`ScriptCompiler.create({headerTag: "werkstatt", registryName:
"werkstattProcessors", functionName: "werkstatt"})` exposes two distinct
operations:

1. `compile(audioContext, editing, deviceBox, source)` is the editor/hot-swap
   path. It strips any old header, parses declarations, validates syntax,
   increments the update, stores header plus source, reconciles parameter and
   sample boxes, and registers the wrapped module through
   `audioWorklet.addModule`.
2. `load(audioContext, deviceBox)` restores already-persisted, headered source.
   A missing header/update zero is a no-op. It registers the source but does not
   perform editor reconciliation.

See the
[compiler lifecycle](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L167-L225)
and
[Blob worklet registration](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L143-L152).

On compile, unchanged declarations preserve their existing parameter boxes and
values. Removed declarations are deleted. A declaration whose mapping/range,
unit, or default changed is recreated at its new default
([parameter reconciliation](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L25-L71)).

`Project.loadScriptDevices()` scans the graph but loads each device UUID only
once. It is a project-restore operation, not a same-device editor API
(`apps/radio/node_modules/@opendaw/studio-core/dist/project/Project.js:145-165`).
A correct live editor must retain a compiler and call `compile`; mutating the
code field and repeatedly calling `loadScriptDevices()` does not hot-compile a
stable device UUID.

### Failure reporting

Confirmed behavior:

- Syntax errors from `new Function(wrappedCode)` reject before the graph is
  changed.
- The graph modifier runs before awaiting `audioWorklet.addModule`. A
  module-evaluation failure, such as a missing `Processor`, can therefore leave
  the new source stored while module registration rejects.
- Constructor errors report `Failed to instantiate Processor`.
- Exceptions from `process()` report `Runtime error` and silence the processor.
- NaN or an absolute amplitude above `1000` reports an error and silences the
  processor.
- A device with no registered processor renders silence and reports once after
  approximately 375 render quanta, about one second at 48 kHz.
- A later successful registry update constructs a fresh processor, reapplies
  cached parameters, and clears the silenced state.

The compile ordering is visible in the
[compiler source](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L193-L225).
Runtime validation and recovery are implemented in the
[WASM bridge](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L87-L99)
and
[processor swap/render path](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L145-L221).
Device messages are available through
`EngineWorklet.subscribeDeviceMessage(uuid, listener)`
(`apps/radio/node_modules/@opendaw/studio-core/dist/EngineWorklet.js:241-244`).

## Confirmed `@sample` limitation

The generic schema and compiler parse `@sample`, create
`WerkstattSampleBox` children, and reconcile their file pointers
([sample parser](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptDeclaration.ts#L144-L159),
[sample reconciliation](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/adapters/src/ScriptCompiler.ts#L73-L118)).

However, the published Werkstatt WASM bridge observes only the parameter
collection and never forwards a sample slot
([Werkstatt exports](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/crates/stock-devices/device-werkstatt/src/lib.rs#L38-L85)).
By comparison, the Apparat instrument explicitly exports a sample-collection
observer and forwards `sample_changed`
([Apparat sample bridge](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/crates/stock-devices/device-apparat/src/lib.rs#L39-L86)).
The shared JavaScript bridge also initializes `proc.samples` and polls sample
frames only for the instrument kind, not for the audio-effect kind
([processor creation](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L161-L180),
[render branches](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/studio/core-wasm/src/script-bridge.ts#L188-L210)).

**Conclusion:** current official Werkstatt audio effects cannot consume
`@sample` data. Supplying a real sample manager, creating file boxes, or
retaining the radio's sample-reference JSON would not complete this path. This
is a concrete upstream runtime limitation, not a licensing issue. The radio
should hide or visibly disable Werkstatt sample controls until the official
device forwards sample slots, unless it intentionally maintains a custom
non-upstream processor.

## Official example inventory

The current official editor ships six examples:

1. [Hard Clipper](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/hard-clipper.js)
2. [Ring Modulator](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/ring-modulator.js)
3. [Simple Delay](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/simple-delay.js)
4. [Biquad Lowpass](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/biquad-lowpass.js)
5. [Alienator](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/alienator.js)
6. [Beautifier](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/examples/beautifier.js)

The list is defined in the
[official example catalog](https://github.com/andremichelle/openDAW/blob/a85f975d766647670ef37e4fcbe0f75901642e72/packages/app/studio/src/ui/devices/audio-effects/werkstatt-examples.ts#L1-L17).

### Recommended minimal radio playground (inference)

The smallest useful preset set for live radio is:

- **Pass Through** — an audibly neutral baseline and safe recovery source;
- **Hard Clipper** — immediate threshold/boolean parameter feedback;
- **Ring Modulator** — stateful oscillator and exponential frequency mapping;
- **Simple Delay** — persistent buffers, feedback, and time mapping;
- **Biquad Lowpass** — two interacting continuous controls;
- **Beautifier** — a musically useful multi-stage example on full-program
  material.

These should reuse the six official sources directly where practical rather
than reimplement their DSP. Alienator can be included as an advanced/fun
preset, but is not necessary for proving the editor/runtime contract.

## Radio integration assessment

The current radio implementation:

- inserts a fixed `// @werkstatt js 1 1` header manually
  (`src/lib/audio/manager/official-opendaw-effect-adapter.ts`);
- creates dynamic parameter boxes from a manually entered JSON object's key
  order rather than the source's declaration order;
- exposes sample-reference JSON even though the published effect bridge cannot
  receive it (`src/components/audio/effect-params/werkstatt-params.tsx`);
- rebuilds the effect group and then calls `Project.loadScriptDevices()`
  (`src/lib/audio/manager/official-opendaw-runtime.ts`);
- does not subscribe to device runtime messages.

That path can instantiate a simple script, but it bypasses the official editor
lifecycle and makes the JSON record, rather than the code declarations, the
control source of truth.

## Recommended implementation seam (inference)

1. Use one retained Werkstatt `ScriptCompiler` configured for
   `werkstatt/werkstattProcessors/werkstatt`.
2. Keep the Werkstatt device box stable during source and parameter edits.
3. Compile source with `ScriptCompiler.compile` outside the surrounding graph
   transaction. Let it own header versions and declaration reconciliation.
4. Derive typed controls and groups from `ScriptDeclaration.parseGroups` and
   `parseParams`; do not ask users to maintain declaration JSON manually.
5. Persist source plus parameter values keyed by label. After constructing a
   device from radio state, compile the source, then restore saved values only
   for declarations that still exist and clamp/map them through their declared
   metadata.
6. Subscribe to `EngineWorklet.subscribeDeviceMessage` using the stable device
   UUID. Expose `idle`, `compiling`, `ready`, and `error` status, retaining the
   editable source and last reported failure.
7. Ship the official examples as a small preset picker plus a Reset/Pass
   Through action.
8. Hide or disable sample declarations with the confirmed runtime explanation
   above.
9. Test declaration parsing, stable hot-swap, value preservation, invalid
   source, runtime-error recovery, output validation, persistence, and at least
   one parameterized preset against real audio.

This is entirely client-side: source parsing, graph edits, JavaScript module
registration, and DSP execution all remain in the browser's AudioWorklet/WASM
engine.
