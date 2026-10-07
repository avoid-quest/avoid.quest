# Node parameter modulation

In Node mode, choose **Add → Modulators**. Connect a control output to a source
or effect's **Parameter** input, then select its numeric target and signed depth
on the cable or in either module's settings. The saved knob value stays authored;
muting, removing or disabling modulation restores it, including while suspended.
**Run** unlocks the browser audio context. Manual gate buttons also accept Space
and Enter. Existing MIDI settings and MIDI learn supply controller input.

All twelve sources have a live output trace: Macro, LFO, Steps, Randomiser,
Follower, ADSR, Curve, Slew, Multi-stage envelope, Shaped LFO, Clock and MIDI in.
Steps has 1–64 editable bars and Euclidean fill. Its random order uses native
openDAW Steps; there is no custom seed. Randomiser retains seed, loop, smoothing
and quantization. Curve points and outgoing bends use the same openDAW curve
method as playback. Timed sources add Free Hz to their own BPM sync rate.

## Playback

Macro, LFO, Steps and Randomiser use native openDAW modulators in Radio's existing
Project. Reset replaces only that source box and transfers its assignments.
LFO delay/fade controls its native amount. Native telemetry already includes
amount and polarity; the trace and Web Audio bridge use that final value.
The other eight sources share one Radio AudioWorklet and call exposed openDAW
`Adsr`, `RMS`, `Smooth`, `Curve.valueAt`, `TidalComputer` and square `LFO` methods.
Follower detects stereo energy at its connected routing tap, including anti-phase
signals, and releases when the tap disappears.

Ordinary effect sliders use native `assign`; openDAW sums signed depths and
clamps in the native field's normalized range. One bridge Macro per worklet
source serves all its native consumers. Outer Mix, linear/folded gains and
Crusher/Fold compensation use Radio's logical scalar and transient writer.
Web Audio pan and filter controls also use transient writes. A Gain or strip
trim folded into an audio cable modulates that cable’s send level. These logical
targets sum offsets in their knob's normalized range before clamping. Distinct
folded gains multiply; strip pans add before clamping. Structural switches,
numeric select controls, transport and source faders remain authored.

Bridge packets arrive at about 30 Hz; Macro and coupled writes share one graph
transaction. Web Audio parameters smooth over 10 ms. Frames never compile a
patch, write the session or add undo history. Assignments follow live effect
boxes after replacement; source clocks survive destination changes. The compiled plan
retains Autotune wrappers for targeted outer controls and folded signal trims. Removing Node
mode releases the owned worklet, boxes, assignments, overlays and subscriptions.

Compatibility-engine targets show **unavailable on Safari/fallback**. Native
source startup failures show unavailable, while independent worklet sources can
continue; **Run** retries startup. Native sources never use duplicate generators.
Short Clock/MIDI gates are retained during startup. Native telemetry is a held
scalar, so fast native threshold crossings may be missed by downstream gates.
Native assignments continue without main-thread delivery; bridged values can
hold while a tab is frozen. Bridges are control-rate, not audio-rate automation.

Validation refuses control cycles and unsupported targets. Current capacities
are 32 modulators, eight followers and the existing eight-LFO budget. Follower
inputs consume no openDAW monitoring channel. Editor ports, cable paths and
rewiring use React Flow; knobs, selects, step bars and switches use shared UI
components. Editor state remains in the existing graph, schema and undo history.

## Verification

Run repository check/typecheck, the radio test suite and production build
(including its lazy Node chunk check). Source state, library math, assignment
ownership, startup events, scalar delivery, restoration and editor behavior have
automated coverage. Browser/device acceptance is recorded in `acceptance.md`.
Physical MIDI/microphone, listening, hidden-tab timing, WebKit and real touch
checks remain separate acceptance gates.
