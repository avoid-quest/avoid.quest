# Radio Lifecycle Workflow Boundary Contracts

Issue: #214
PRD: #213
Date: 2026-05-05

## Scope

This approves the caller-facing target contracts for the two radio lifecycle
workflow boundaries from PRD #213:

- DJ deck and channel lifecycle.
- Playback mode activation and switching.

This is an implementation-direction slice. It does not change product behavior,
stored data shape, browser/runtime APIs, or compatibility exports.

## DJ Deck And Channel Lifecycle Boundary

Approved target workflow boundary:

```ts
type RadioDjLifecycleWorkflow = {
  loadDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>;
  resetDeck: (deckId: DeckId) => Promise<void>;
  playDeck: (deckId: DeckId) => Promise<void>;
  pauseDeck: (deckId: DeckId) => void;
  clearDeck: (deckId: DeckId) => Promise<void>;
  updateChannelStrip: (
    deckId: DeckId,
    change: ChannelStripChange
  ) => Promise<void> | void;
  updateChannelEffect: (
    deckId: DeckId,
    change: ChannelEffectChange
  ) => Promise<void> | void;
  handleAudioState: (deckId: DeckId, state: AudioState) => void;
};
```

UI and command callers should use this boundary for user-level DJ deck
operations. Audio callbacks may enter through `handleAudioState`, but callers
should not directly compose deck collection updates, playback runtime updates,
`AudioManager` calls, cue routing, channel activation, strip replay,
continuation, stream refresh, or DJ error reporting.

Owned by the boundary:

- Deck load, replacement, ejection, reset, play, pause, repeat, and autoplay.
- Channel activation and deactivation for DJ deck channels.
- Persisted deck/channel mutation and runtime audio state sync.
- Sound id selection, sound cleanup, subscription cleanup, and local file object
  URL release when replacing file-backed sources.
- Stored volume, mute, pan, speed, channel filter, dry/wet, effect order,
  effects, and filter replay after the active sound is ready.
- Cue bus reconnection, saved output device initialization, and crossfade
  application after play and relevant volume changes.
- YouTube lazy stream resolution for playlist continuation and interrupted
  stream refresh.
- User-safe DJ/playback error reporting with raw causes preserved only for
  diagnostics.

Not owned by callers:

- Direct calls to `activateChannel`, `deactivateChannel`,
  `applyStoredChannelStrip`, `applyStoredEffectsAndFilters`,
  `connectDeckCueBus`, `initializeAudioDevices`, playlist continuation helpers,
  or platform stream resolution.
- Direct mutation of deck runtime fields as part of load/play/pause lifecycle.
- Direct `AudioManager` singleton access for migrated deck commands.

Approved near-term implementation direction:

- Deepen the current `createDjDeckLoadWorkflow` and
  `createDjDeckContinuationWorkflow` work into one DJ lifecycle workflow module
  instead of adding another shallow wrapper.
- Keep transport and crossfade operations on the injected
  `PlaybackActionContext.audioEngine` facade wherever the narrow facade already
  supports the operation.
- Add new facade operations only when the workflow needs a behavior-focused
  capability; do not expand legacy `AudioManager` reach-through casually.

## Mode Activation And Switching Boundary

Approved target workflow boundary:

```ts
type RadioModeLifecycleWorkflow = {
  activateInitialMode: (mode: PlaybackSessionId) => Promise<void>;
  switchTo: (mode: PlaybackSessionId) => Promise<void>;
  getSnapshot: () => ModeTransitionSnapshot;
  subscribe: (listener: () => void) => () => void;
  reset?: () => void;
};
```

Callers should use this boundary for startup activation and user-requested mode
changes. They should not directly coordinate settings persistence, session
readiness, mode-specific restoration, deactivation cleanup, rollback, or orphan
sound checks.

Owned by the boundary:

- Waiting for persisted playback sessions before activation.
- Startup activation that remains retryable when session state is unavailable.
- Serializing mode transitions by rejecting overlapping switch requests.
- Deactivating the previous mode, activating the requested mode, and committing
  settings only after successful activation.
- Rolling back to the previous active mode when activation fails.
- Delegating single and multiple mode restore/cleanup to the managed playback
  session workflow.
- Delegating DJ restore/cleanup to the DJ mode lifecycle workflow.
- Fade-out cleanup, runtime reset, stale error clearing, and orphan sound
  detection for deactivated sessions.

Not owned by callers:

- Direct `updatePlayerSettings` calls for mode changes.
- Direct mode-specific session activation from UI components.
- Direct runtime cleanup or audio reset during a mode switch.
- Manual restoration of deck, single, or multiple channel sounds during startup.

Approved near-term implementation direction:

- Keep `createModeManager` as the caller boundary and continue to hide
  `createModeLifecycleRegistry`, `createDjModeLifecycleWorkflow`, and
  `createManagedPlaybackSessionWorkflow` behind it for app callers.
- Continue committing the selected mode only after activation succeeds.
- Keep concurrent transition behavior as rejection with
  `"Mode transition in progress"` unless a later issue explicitly asks for
  queueing semantics.

## Dependency Strategy

Local substitutes:

- Runtime stores and persisted playback collections should remain local,
  deterministic substitutes in tests. Workflow tests may reset and seed
  `playbackSessionsCollection` and runtime stores directly as test setup, then
  assert behavior through workflow public methods and public reads.
- Browser audio behavior should be substituted with the existing audio engine
  lifecycle harness or narrow fakes at the `PlaybackActionContext` /
  `AudioEngineFacade` boundary.

Audio engine ports:

- Migrated workflow commands should consume `PlaybackActionContext.audioEngine`
  first for transport and volume operations.
- Legacy `PlaybackActionContext.audio` access is allowed only for existing
  compatibility operations that have not yet moved to the facade.
- Tests should fail if a migrated command unexpectedly reaches the default
  singleton when an injected context/facade was supplied.

Runtime and persistence ports:

- Channel lifecycle operations should be injected through
  `PlaybackActionContext.channels`.
- Playback session reads and writes may remain direct inside the owning radio
  workflow modules until a later issue introduces an explicit repository port.
  Callers outside the workflow should not manually compose those writes with
  runtime/audio side effects.

External platform ports:

- True provider-backed stream resolution must be injected. Production adapters
  may call `@avoid.quest/platforms`; tests must provide deterministic resolvers.
- YouTube playlist continuation and interrupted stream refresh should remain
  covered through the injected stream resolution port, not network access.

## Compatibility Shims

The following compatibility surfaces may remain while migration proceeds:

- `setDeckRadioSource()` as a shim over deck loading.
- `setDeckARadio()`, `setDeckBRadio()`, `playDeckA()`, `playDeckB()`,
  `pauseDeckA()`, `pauseDeckB()`, and reset helpers as UI-facing command
  aliases that delegate to the approved DJ lifecycle boundary.
- `createDjDeckLoadWorkflow()` and `createDjDeckContinuationWorkflow()` as
  internal migration pieces until a unified DJ lifecycle workflow owns both
  surfaces.
- `createDjModeLifecycleWorkflow()` and
  `createManagedPlaybackSessionWorkflow()` as mode-manager-owned collaborators,
  not direct app caller APIs.
- Default singleton-backed context creation for legacy browser callers, provided
  new tests and migrated paths prefer explicit context injection.

Shims must stay behavior-preserving and thin. They may translate old function
names to user-level workflow commands, but they must not grow independent
sequencing, persistence, audio, or error-handling behavior.

## Testing Boundary

DJ lifecycle tests should enter through the approved DJ workflow commands and
assert outcomes callers and users depend on:

- Successful load activates the deck channel and restores saved strip/effects.
- Replacement and ejection clean up previous sounds, subscriptions, runtime
  state, and file object URLs.
- Failed load rolls back persisted deck radio state and reports user-safe
  errors.
- Play, pause, crossfade, repeat, autoplay, YouTube stream resolution, and
  interrupted stream refresh operate through injected ports.
- Device and local-file deck sources follow the same lifecycle ownership rules
  where product behavior allows.

Mode lifecycle tests should enter through `createModeManager` or the exported
singleton manager and assert boundary behavior:

- Initial activation waits for persisted session readiness and remains
  retryable on failure.
- Switching deactivates the old mode, activates the new mode, commits settings
  after success, rejects overlapping transitions, and rolls back on activation
  failure.
- Deactivation fades and cleans up owned sounds, resets runtime state, clears
  stale errors, and detects orphaned sounds.
- Single, multiple, and DJ restoration create only restorable sounds and skip
  local-file or unsupported platform sources.

Tests should avoid asserting private helper call order unless the helper is an
injected external port. Existing shallow tests should be pruned only after the
same user-visible behavior is covered through the boundary tests above.

## Approval

These contracts are approved for the follow-up implementation slices under PRD
#213. Future slices should preserve product behavior while migrating callers and
tests toward these two boundaries.
