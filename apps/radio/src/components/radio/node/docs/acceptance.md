# Node Mode release acceptance

Use this matrix before releasing Node Mode or changing browser input, playback
unlock, capture, output routing or MIDI behavior. Record the commit, browser,
device, scenario and observed result when a pending gate is completed. A failed
gate needs a reproducible failure; a missing device stays **unverified**.

## Deploying is one-way

Releasing Node migrates stored data in place: the mode becomes `"node"`, the
`"multiple"` session becomes a `"node"` patch, and file backups that carry Node
data are export version 3. A release from before Node cannot read that state
(it fails on the `"node"` mode), so **rolling back is a roll-forward**: a new
release that runs `migrateNodeToMultiple`
(`src/lib/collections/migrations/node-to-multiple.ts`) at init, never a revert of
this deploy. Nothing deletes what that fix needs:

- localStorage `radio-app-multiple-backup` keeps the Multiple session and mode
  as first stored, and `migrateNodeToMultiple` rebuilds from it when the patch
  has no Station lanes. The `"multiple"` record is deleted only once Node or
  that backup holds it.
- localStorage `radio-app-node-graph-backup` keeps every stored patch the v2
  upgrade could not read before it was dropped.

## Recorded browser checks

Checked on 2026-10-01 (Europe/Rome) in T3 Code's collaborative preview against the
combined fix stack served from `be9d767`, using Chromium 152 / Electron 44.
The desktop viewport was 1280×800; the phone viewport was 390×844. Resizing keeps
the desktop browser engine and user agent; it does not establish iPhone/WebKit
compatibility.

The fixture began with Speakers only, seeded in localStorage, then used the
palette to add modules. Existing library/settings and all session data were
restored afterward. Keyboard/click actions used preview controls; the gesture
rows explicitly identify DOM events injected into the running app.

| Scenario | Result and evidence |
| --- | --- |
| Empty modules with no compiled lanes | **Passed:** palette added empty Station, File, Audio input, Output device and loose Gate. Rack listed every module with settings access. |
| Desktop inspector | **Passed:** empty Station search, File picker/URL tabs, Output device selection and Gate parameters opened from Rack. |
| Collapsed desktop Rack | **Passed:** separator End collapsed the panel to 0px; Gate → All settings expanded it to 240px and exposed parameters. |
| Desktop Rewire and Undo | **Passed:** keyboard selected Output device as the Station cable destination. Apply preserved cable identity, gain and mute; one Undo restored Speakers. |
| Phone layout and inspector | **Passed in Chromium viewport:** Stage/Rack/Patch accessible; Rack opened the Audio input drawer. Drawer showed Off and the browser's blocked-microphone message. No document-level horizontal overflow. |
| Phone Rewire | **Passed in Chromium viewport:** focused cable selected with Enter; toolbar opened a 358px dialog inside the 390px viewport. Keyboard destination selection and Apply stored the correct route. |
| Knob keyboard accumulation | **Passed:** five ArrowUp presses moved Gate threshold from −6 to −3.5; five synthetic key events before a render reached the same stored value. |
| Knob reset | **Passed with synthetic events:** double-click and Ctrl+primary pointer-down restored Gate threshold to −6 in both UI and stored graph. |
| Knob fine wheel | **Passed with synthetic wheel:** one upward event changed threshold from −6 to −5.99 and persisted it. |
| Slider fine wheel and reset | **Passed with synthetic events:** phone Stage master slider moved from 0.99 to 0.98 for one downward wheel event; Ctrl+primary reset UI and stored master volume to 1. |

The local feedback availability request returned HTTP 502. It did not prevent
these Node interactions. No audio playback, permission grant or hardware routing
success is inferred from this run.

## Recorded modulation checks

Checked on 2026-10-07 in T3 Code's collaborative preview with Chromium
154.0.8037.92, a 1280×800 desktop viewport and cross-origin isolation enabled.
The tested code is this `node-modulation/editors` implementation on parent
`f901fc81`. Palette actions used browser controls; authored fixtures, gates,
MIDI messages and the silent FX harness used exported application APIs.

| Scenario | Result and evidence |
| --- | --- |
| Palette and twelve sources | **Passed:** Add/search created Macro. All twelve sources ran together: four openDAW sources and eight sources in the Radio worklet, with no runtime warning. LFO, Steps, Randomiser, Curve, Shaped LFO and Clock changed over time. |
| Amount, polarity and downstream control | **Passed:** Macro value 0.75, amount 0.8 and bipolar produced 0.400; connected Slew reached 0.400. Neither transformation was applied twice. |
| Gates and synthetic MIDI | **Passed:** held ADSR reached 0.500, Multi-stage reached 0.800, and synthetic note-on reached MIDI gate 1. Release/note-off returned all three to zero. Saved graph JSON remained unchanged. |
| Live native and scalar targets | **Passed in a silent API harness:** twelve native assignments shared a Delay feedback field; nine Macros comprised the native Macro plus eight source bridges. Feedback's authored value stayed 0.500 while its controlled value moved. Twelve connected Web Audio gains followed source values; outer Mix transient writes returned `applied`, with the authored effect config unchanged. |
| Anti-phase follower | **Passed in the same harness:** a stereo 440 Hz oscillator with opposite channel polarity produced a nonzero follower value (about 0.568 after sensitivity), then released after its tap disconnected. No microphone or music input was used. |

Fixture nodes were removed and the original preview graph restored. The
isolated harness uses the production runtime and public FX writer; its synthetic
audio and parameter observations establish wiring, not listening quality.
Feedback availability still returned HTTP 502 independently of modulation.

## Pending device and listening gates

Every row below is **unverified**. The preview has no physical iPhone, external
audio interface, MIDI controller or listening evidence. Synthetic pointer events
and passing regression tests cover modeled behavior, not these acceptance gates.

| Gate | Required observation |
| --- | --- |
| iPhone WebKit playback unlock | Four independent stream lanes start from one Play all gesture, then pause and switch Single/Node/DJ without surviving old sounds. Repeat after reload/backgrounding. |
| Physical touch gestures | Double-tap knob and slider resets; ordinary drag remains usable. Pinching during an insertion drag cancels insertion. Rewire works through port selection with a finger and preserves branch settings. |
| Microphone permissions and lifetime | Grant, deny and browser-level permission reset update the UI. Go live uses saved level/channels from its first audible sample. Cancel/remove/mode-switch during permission pending leaves no live capture. Unplug and reconnect permit explicit recovery. |
| Main output, second output and CUE | A real interface routes intended lanes to distinct sinks; mute/level/CUE behave independently. Unplug or rejected sink selection shows recovery and Retry works without resurrecting a deactivated lane. Test capability fallback in a browser without sink routing. |
| MIDI hardware and identity | A controller changes the selected FX; deleting/recreating it does not reuse the old mapping, while Undo restores its identity and mapping. |
| Audible branch and FX behavior | Gain/cable trims remain audible on dry and wet paths at 0/50/100% mix. Structural swaps follow the duck/swap path without clipping or stale audio. Vocoder external key removal restores the authored modulator. |
| NAM backup across browsers | Export a patch with local NAM assets, import into a fresh browser and listen to the restored model. Rejected import preserves the existing patch and model bytes. |
| Live providers and local files | Search/load platform media, select tracks rapidly, pause an advancing playlist and exercise initial/mid-play URL renewal against real providers. Local-file Undo remains playable; reload asks to pick the file again. |
| Modulation listening and timing | Listen to native and bridged sweeps, Mix/gain extremes, Clock/MIDI gates and real mono/stereo follower inputs. Measure bridge latency/jitter, hidden-tab holds, native reset phase and long-session CPU/heap/underruns. Test native telemetry's short-crossing limits, openDAW restart and physical MIDI unplug/reconnect. |

Use the [current contract and source map](../../NODE_MODE_PROPOSAL.md) to find the
affected seam, and the repository's [validation contract](../../../../../../../AGENTS.md)
for code checks. Update this evidence when the tested commit or browser behavior
changes; pending gates remain pending until their observations are recorded.

LFO shape and Steps/Random repetition run inside openDAW's engine. The Radio worklet supplies LFO delay/fade amounts and the other DSP sources; editors use emitted native telemetry.
