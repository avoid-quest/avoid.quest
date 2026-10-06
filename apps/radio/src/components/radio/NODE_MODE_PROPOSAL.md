# Node Mode v1

Node Mode replaces Multiple with a React Flow patch editor, Stage and Rack over
radio's managed playback engine. This is the current implementation contract for
agents changing Node Mode. The product release is **v1**; its persisted graph
schema is **version 2**, which added source strips. Schema versions and the
[future product roadmap](node/docs/roadmap.md) are separate concepts.

For a historical PR's originating spec or the reasons behind an earlier proposal,
read the [design history](node/docs/design-history.md). Its delivery sequence,
prototype paths and open questions describe the design at that time.

## Document and persistence

The Node session owns one authored graph, its Speakers master volume and derived
lane channels. Nodes, cables and viewport are the document; `session.channels` is
a compiler-derived cache, never a second patch to edit independently. Runtime
playing/loading state, sound ownership and meter levels stay outside the graph.

Every stored or imported graph enters through `migrateNodeGraph`. Schema version
1 receives default source strips. A graph from a newer app remains stored intact,
with an explicit read-only state; this app neither edits nor plays that graph.
An explicit valid backup import can replace it, with the replacement disclosed in
the preview.

Multiple sessions, settings and backups migrate to Node, preserving sources,
order, levels and master volume. New users start with **Starter**: one empty
Station wired to Speakers. **All my stations** (`start-from-multiple`), **Duck**
and **Blank** are explicit templates. Template replacement is undoable during the
active session.

Disabling playback restoration preserves an authored Node document and its
settings. Playback still starts paused, and loading a patch turns every Audio
input's Monitor off. An input is opened only by a user action.

Backups include the Node graph, master volume and referenced local NAM model
assets. Merge and Replace both replace an included Node patch; station share links
carry library data without sessions. A rejected import leaves the existing library,
settings, patch and local models intact. Local audio files remain browser object
URLs and require picking again after reload or on another device.

## Graph and engine

Each filled Station, Track, File or configured Audio input owns an independent
managed lane. Station plays radio; Track searches or loads YouTube, SoundCloud and
Bandcamp items; File accepts a local file or a static audio URL. Saved library
membership and patch membership are separate: saving a search result to the
library does not add another node automatically.

A patch has exactly one Speakers. An Output device adds a separately selected
physical sink when the browser supports routing. Source lanes can feed both;
several Output device nodes may use the same physical device with independent
mutes. A lane without an output cable is silent. Output-device selection failures use the
existing main-output fallback and expose a user retry. Browser capability checks
and device status determine which controls are available.

Audio inputs sum any number of distinct cables and outputs fan out. Sources can
share a Merge or FX directly; Filter and Pan can appear anywhere, repeatedly.
Branches may feed different outputs, cross other branches or rejoin without an
explicit Merge. Stereo Split and Band Split keep distinct channel/band outputs.
Audio and control remain separate signal types. Merge sums control inputs and
Split fans them out; parameter assignments still use signed depth.

Simple source-owned trees retain the existing lane engine. Other patches use
`audio-patch-plan.ts` and `node-audio-patch.ts`: one stable module per node,
one gain per cable, and one FX processor per used output port. Shared downstream
FX process the summed input once. The source's post-fader output feeds this graph;
cable gain/mute and split pan/solo operate along the drawn paths. Unused FX ports
start only when connected. FX reuse the existing official/compatibility backend
selection rather than creating synthetic playback sounds.

In an explicit patch, split routing stays active when its controls are bypassed.
Stereo and band ports retain their channel or band; Split distributes the dry
signal across its connected ports. Dry/wet mixes neutral routing with the authored
branch gain and pan, so rejoining distinct ports adds the dry component once.
Configured chain solos and cable solos share one effective branch set. The last
cable leaving an FX port releases its processor after the cable fade.

Dashed audio key cables feed supported sidechain ports from the exact cabled
output, including processed, split or merged signals. Multiple keys sum with
cable gain/mute. A connected, unmuted Vocoder key selects the external modulator
only at runtime; removing or muting all keys restores its authored setting.
Follower inputs likewise detect the summed signal at their cables, including
cable levels, rather than the end of a source's whole lane.

Every connection path uses the same typed-port verdict. Duplicate cables,
delay-free audio feedback (including key feedback), control cycles, invalid
parameter assignments and unsupported nodes remain refused. Compilation validates
again and excludes invalid routes. The patch permits 256 cables; source, playing
stream and total modulator/follower budgets remain in force.
Only passive control routers connected to accepted sources or consumers execute
in the worklet; isolated router islands do not add recurring audio-thread work.

The catalogue's ship flags define the available v1 nodes and ports. The schema
also describes future nodes so migrations can identify them; schema membership
alone does not make a node playable. `validate.ts` owns device budgets and graph
issues, and the runtime enforces the playing-stream limit at start time.

Each source strip has trim, pan, mute and solo. Track and File add speed, key lock,
seek/cue, whole-track Loop and headphone cue listening. Their Loop suppresses
playlist advance. This source transport control is distinct from the unshipped
routing **Loop** node.

Starts, track selection, playlist advance and stream renewal belong to the current
activation, source and playback request. Pausing, removing/replacing a source or
leaving Node invalidates stale async completions. Late microphone streams are
stopped; a new capture receives its saved level and channels before monitoring.
Platform media receives bounded initial-load and mid-play renewal using its
original identity.

Graph commits compile and reconcile in batches. Parameter edits reuse lanes and
FX. Source-tree structural changes use the existing duck/swap/restore path;
explicit graphs fade removed cables and retain unaffected processors. Meter-rate
updates bypass React graph state. Undo/Redo retain referenced NAM bytes and local
file URLs; cleanup releases resources only after no retained document or live
sound needs them. New FX instances receive fresh identities, while Undo restores
the original instance and its MIDI mapping.

Parameter modulation adds control sources, signed assignments and transient
runtime values. When changing sources, targets, cable editing or their playback
bridge, read [the modulation contract](node/docs/modulation.md) for the prototype
workflow, engine boundaries and verification criteria.

## Editing and accessible controls

React Flow renders the controlled graph. Local drag frames commit positions at
release; insertion and cable surgery commit one undoable graph change. Cancelling
or pinching a drag clears its insertion target. Removing a Merge heals each
incoming audio path to its destinations; independent branches remain playable.

Stage and Rack provide source controls outside the zoomed canvas. Rack also lists
loose, empty or invalid modules and shows graph issues when no lane compiles.
Inspect opens shared source, device, native, FX or output settings; desktop Inspect
expands a collapsed Rack panel and phones use the inspector drawer. Local files
that cannot survive reload expose Pick again.

Connection hints and the Connect/Replace dialog use the same verdict as drag
connections. The Rewire dialog provides the touch-accessible edit path for either
end of a selected cable, preserving its identity and branch settings.
Canvas selection keys act on the focused module or cable; global Space playback
is reserved for focus outside those graph elements and ordinary controls.

Shared knobs and sliders reset on double-click, double-tap or Ctrl + primary
click. Wheel input changes continuous values by 0.01 parameter units; discrete
parameters retain valid whole steps. Immediate control input accumulates before
throttled graph or engine writes.

## Source map

| Change | Start here |
| --- | --- |
| Document versions, source strip defaults | [`schema.ts`](../../lib/node-graph/schema.ts) |
| Available nodes, typed ports and FX defaults | [`catalogue.ts`](../../lib/node-graph/catalogue.ts) |
| Budgets, diagnostics, connection verdict | [`validate.ts`](../../lib/node-graph/validate.ts) |
| Lane lowering and graph planning | [`compile.ts`](../../lib/node-graph/compile.ts) |
| Parameter versus structural engine changes | [`reconcile.ts`](../../lib/node-graph/reconcile.ts) |
| Pure graph edits, templates, undo/history | [`graph-edits.ts`](../../lib/node-graph/graph-edits.ts), [`templates.ts`](../../lib/node-graph/templates.ts), [`node-store.ts`](../../lib/node-graph/node-store.ts) |
| Activation, lane ownership and transport | [`node-playback.ts`](../../lib/node-playback.ts), [`pending-channel-starts.ts`](../../lib/pending-channel-starts.ts) |
| Shared graph processors and exact cable taps | [`node-audio-patch.ts`](../../lib/audio/routing/node-audio-patch.ts), [`audio-patch-plan.ts`](../../lib/node-graph/audio-patch-plan.ts) |
| Output sends and physical device sinks | [`node-lane-outputs.ts`](../../lib/audio/routing/node-lane-outputs.ts), [`node-device-sinks.ts`](../../lib/audio/routing/node-device-sinks.ts) |
| External source loading and local file lifetime | [`node-source-loaders.ts`](../../lib/node-source-loaders.ts), [`sources.ts`](../../lib/node-graph/sources.ts) |
| Persistence, migration and local NAM retention | [`playback-sessions.ts`](../../lib/collections/playback-sessions.ts), [`migrations/`](../../lib/collections/migrations/) |
| Backup validation, preview and application | [`export-import.ts`](../../lib/db/export-import.ts), [`nam-backup.ts`](../../lib/db/nam-backup.ts) |
| Canvas, palette and cable editing | [`node-canvas.tsx`](node/node-canvas.tsx), [`node-palette.tsx`](node/node-palette.tsx), [`connect-dialog.tsx`](node/connect-dialog.tsx), [`rewire-dialog.tsx`](node/rewire-dialog.tsx) |
| Stage, Rack, inspector and shared source forms | [`node-stage.tsx`](node/node-stage.tsx), [`node-rack.tsx`](node/node-rack.tsx), [`node-inspector.tsx`](node/node-inspector.tsx); source/device `*-content.tsx` files beside them |
| Shared knobs, sliders and control gestures | [`knob.tsx`](../../../../../packages/ui/src/components/knob.tsx), [`slider.tsx`](../../../../../packages/ui/src/components/slider.tsx) |
| Node MIDI identities and actions | [`node-midi-actions.ts`](../../lib/midi/node-midi-actions.ts), [`use-node-midi.ts`](../../lib/hooks/use-node-midi.ts) |

## Verification boundary

Before release or browser/device acceptance work, read the
[acceptance matrix](node/docs/acceptance.md) for recorded UI checks and pending
physical-device gates.

Use the repository's [validation contract](../../../../../AGENTS.md) for code
changes and the adjacent regression tests for the affected seam. A passing mock
proves the modeled ownership, routing or persistence rule; audible behavior and
real device permissions require browser/device evidence.

Physical acceptance remains pending for iPhone WebKit multi-stream Play all and
mode switching, microphone permission/unplug/reset, second-output routing and cue,
MIDI hardware, touch drag/pinch/rewire and audible structural FX swaps. Platform
search/resolve depends on live providers and also needs release checks. Record the
browser/device, scenario and observed result when completing each gate; mark a
missing device or unavailable provider as unverified.
