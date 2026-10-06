# Node Mode roadmap

These are unshipped product directions. They are not required follow-ups for a v1
bug fix. Use [the current contract](../../NODE_MODE_PROPOSAL.md) for implemented
behavior, and the [design history](design-history.md) when the original rationale
or interaction sketches matter. The catalogue's ship flags and compiler remain
the source of truth for availability.

## A later product v2

- **Cross-source buses:** shared Merge/FX buses, sends and returns, crossfade and
  Dial routing. Sources already mix at physical outputs; a shared authored bus is
  the missing capability. Revisit ownership, latency and loudness at that seam.
  The current engine imposes three constraints on that design.
  `EffectsController.reconcile` accepts only registered AudioManager sounds, so
  bus FX need an owned bus registration rather than a synthetic sound id.
  Validation refuses a key cable into FX outside a station lane; keep that
  refusal until bus FX receive a resolved key source. A pre-fader send must tap
  the lane's `preFaderSend`, because `nodes.gain` is already post-fader.
- **Additional control sources:** song/title triggers and Sundial remain
  unshipped. The [modulation prototype](modulation.md) now exposes Macro,
  MIDI input, LFO, Clock, Randomiser, Follower and envelope/curve/smoothing
  modules through a transient parameter path.
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
