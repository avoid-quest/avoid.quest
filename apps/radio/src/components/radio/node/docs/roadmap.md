# Node Mode roadmap

These are unshipped product directions. They are not required follow-ups for a v1
bug fix. Use [the current contract](../../NODE_MODE_PROPOSAL.md) for implemented
behavior, and the [design history](design-history.md) when the original rationale
or interaction sketches matter. The catalogue's ship flags and compiler remain
the source of truth for availability.

## A later product v2

- **Sends and returns:** crossfade and Dial routing, and pre-fader sends.
  Shared FX already run as graph units after the faders (`node-engine/routing.ts`).
  Validation still refuses a key cable into FX that several sources share,
  until keys tap any point. A pre-fader send must tap the lane's
  `preFaderSend`, because `nodes.gain` is already post-fader.
- **Split branches to different places:** an explicit Split, Stereo Split or
  Band Split whose branches don't meet again is refused until its split stage
  lands, chosen by measurement (`node-engine/bench`).
- **Control graph:** Macro, MIDI-in cables, LFO, Clock, Randomiser, Follower,
  song/title triggers and Sundial. Preserve graph validation and define how
  modulation reaches current engine parameters before exposing those ports.
  Graph commits and `channelEffects.change` persist authored values and trigger
  reconciliation. Continuous modulation therefore needs a transient runtime
  parameter path that changes neither the session nor the authored base value.
- **Additional routing/output nodes:** delayed feedback Loop, Tape Warp, Scope,
  Headphones and Recorder. The shipped per-source whole-track Loop and cue bus do
  not imply these authored nodes are implemented.
- **Patch library and sharing:** named patches and patch share links. Current
  backups contain one session patch; station share links intentionally omit it.
  A patch-sharing design must account for local files/NAM assets and token-bearing
  source URLs before deciding what can travel between browsers.

## Separate decisions and measured work

- Werkstatt and a React Flow major-version upgrade need their own backend and
  migration checks. Attribution was deliberately removed in the implemented v1;
  the old proposal question is closed.
- Accepted timing exception: a path that leaves openDAW and re-enters it (for
  example a Pan or a summing point between official FX) arrives one render
  quantum late, and Chromium's render order decides whether its rejoining
  siblings are compensated exactly or land one quantum (about 2.7 ms) apart.
  Only same-source paths that rejoin across such a loop are affected; closed
  regions without native points stay inside one openDAW chain. Removing it
  would need routing changes, not more compensation.
- Seamless structural FX swaps, sample-aligned cross-source routing, optional
  loudness limiting and layout/performance optimizations need evidence and a
  bounded design. The existing v1 duck/swap path and browser output capabilities
  remain the current behavior.
- Curated patch membership is intentional. Automatic canvas insertion on library
  Save is a product decision, independent from source loading.
- Recorder/export formats, rights handling and source eligibility belong to the
  Recorder design once that work is requested.

Schema version 2 is already implemented for source strips. It is unrelated to the
future product v2 listed here.
