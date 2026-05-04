# Radio Sandcastle Closure Audit

Issue: #201
Date: 2026-05-04

## Scope

This audits the closed Sandcastle radio issues #188, #189, #190, #191, and #192
against the current `sandcastle/issue-201-radio-follow-up-audit-sandcastle-closures`
branch after follow-ups #195, #196, #197, #198, #199, and #200 landed.

The follow-up chain completed bounded migration slices. It did not fully
complete every original epic acceptance criterion. Remaining gaps below are
documented as deferred follow-up scope unless called out as a correctness risk.

## #188 Consolidate Playback Action Orchestration Layer

Status: partially accepted, with remaining migration scope deferred.

Implemented and covered:

- `PlaybackActionContext` is the explicit command boundary for new playback
  paths, including `audio`, `audioEngine`, channel lifecycle operations, routing
  lifecycle state, error reporting, and reset behavior
  (`apps/radio/src/lib/playback-action-context.ts`).
- Single and multiple playback command paths accept an injected context and use
  the shared channel facade for volume/lifecycle operations
  (`playback-actions-single.ts`, `playback-actions-multiple.ts`).
- A complete DJ deck command path is context-injectable and covered by tests
  that fail if the singleton is reached (`dj-actions-deck-commands.test.ts`).
- User-facing playback errors are normalized through
  `playback-action-errors.ts`; raw exception text is preserved separately and
  runtime errors render safe messages.
- The old `audioRoutingInitialized` module flag has been replaced by
  `ctx.lifecycle.mainOutputSettingsApplied`.
- Channel subscription cleanup is owned outside the runtime store by
  `channel-state-manager.ts`; `dj-runtime-store.test.ts` verifies subscription
  cleanup internals are not exposed on the DJ runtime compatibility surface.

Deferred:

- The original criterion "no more `getAudioManager()` singleton calls in action
  code" is not globally met. Compatibility defaults still use
  `AudioManager.getInstance()`, and some unmigrated paths still route through
  singleton-backed helpers.
- DJ action files remain split by deck load, input sources, routing, channel
  strip, decks, and playlist. The accepted follow-up scope migrated a complete
  deck command path rather than consolidating all DJ action files.
- Error handling is shared for migrated paths, but single/multiple hook-local
  error setter helpers still exist as display adapters.

Audit conclusion: #188 follow-up closure is acceptable as an incremental
orchestration migration. Full action-file consolidation and singleton removal
remain deferred.

## #189 Decompose AudioManager Monolith

Status: partially accepted, with original public-method-count target replaced by
an explicit facade budget.

Implemented and covered:

- `AudioEngineFacade` records the architecture decision: keep `AudioManager` as
  the singleton compatibility object and use `AudioEngineFacade` as the narrow
  subsystem boundary for migrated paths.
- The facade has an explicit callable budget of 15 and currently exposes 6
  callable methods across playback and volume; this is tested in
  `audio-engine-facade.test.ts`.
- The migrated DJ deck transport/crossfade path consumes the facade instead of
  broad legacy `AudioManager` transport and volume methods
  (`dj-actions-deck-commands.test.ts`).
- Focused subsystem files exist for sound registry, volume, metering, effects,
  output routing, graph helpers, and facade wiring. Sound registry and volume
  controller have dedicated tests.

Deferred:

- `AudioManager` itself still exposes more than 15 public methods for
  compatibility. The original #189 method-count criterion is not met on the
  class; the replacement budget applies to `AudioEngineFacade`.
- Not every subsystem is independently instantiable without Web Audio setup.
  Test coverage proves selected subsystems and migrated facade paths, not the
  full original decomposition.
- Graph topology is still not fully declarative and inspectable as data.
- Many existing callers still use the compatibility manager directly.

Audit conclusion: #189 is accepted only under the #198 replacement metric:
facade API budget and one migrated playback path. Full monolith decomposition
remains deferred.

## #190 Unify Session State Management

Status: substantially accepted for channel lifecycle/state ownership, with
remaining hook/query migration deferred.

Implemented and covered:

- `channel-state-manager.ts` provides the unified channel read/write and
  lifecycle boundary: merged channel state reads, collection updates, active
  audio sync, activation, runtime subscriptions, meter subscriptions,
  deactivation, audio cleanup, and runtime reset.
- Channel parameter updates for volume, mute, pan, speed, filter, dry/wet, and
  effects persist through the playback session collection and sync active audio
  where applicable.
- `channel-state-manager.test.ts` covers
  `update channel volume -> collection persisted -> audio engine receives update`
  and lifecycle-owned cleanup.
- Session-only Radio Garden radios are represented through
  `sessionRadiosCollection` backed by `sessionStorage`, with legacy storage-shape
  restore and add/remove/save tests.
- DJ deck reads use `useChannelState` / `getChannelState`; `updateDeckA`,
  `updateDeckB`, and mixer helpers write through playback sessions rather than
  legacy DJ collections.
- Runtime updates are centralized through functional store setters in
  `playback-runtime-store.ts`.

Deferred:

- Legacy `singleStateCollection`, `deckCollection`, and `mixerCollection` still
  exist as read-only migration sources. No active write paths were found in the
  audited app code, but the collections remain importable.
- Single and multiple hooks still manually compose session records and runtime
  state. DJ hooks are thin over `useChannelState`, but the original "single state
  query surface for all hooks" criterion is not completely met.
- Some direct state/action helpers remain for compatibility while callers migrate
  to the channel facade.

Audit conclusion: #190 follow-up closure is acceptable for state mutation,
session-radio migration, and channel lifecycle ownership. Full hook/query
surface simplification remains deferred.

## #191 Consolidate Effect Chain Pipeline

Status: substantially accepted for conversion, readiness, and ordering
follow-ups; full single-source parameter typing remains deferred.

Implemented and covered:

- Effect conversion now derives effect-specific parameters from
  `getEffectParamDefs(type)` instead of handwritten per-effect case statements
  (`audio-manager-effects.ts`).
- Checkbox boolean-to-number coercion and `dryWet` to `wet`/`dry` conversion are
  centralized in the conversion layer.
- `audio-manager-effects.test.ts` verifies every schema parameter from default
  configs is converted, verifies universal/dry-wet conversion, and confirms
  `order` is excluded from worklet params.
- `effect-order.ts` owns ordering normalization, add ordering, reorder
  serialization, and playback ordering. `channel-state-manager.test.ts` and
  `dj-actions-channel-strip.test.ts` cover add, reorder, persisted replay, and
  WorkletManager reorder commands.
- `applyStoredEffectsAndFilters()` checks WorkletManager readiness explicitly
  through `getWorkletManager()` / `ensureEffectsReady()` before replaying stored
  effects; the previous `setTimeout(100ms)` retry pattern is gone.
- `EffectChain` keeps optimistic local drag state for UX while persisted order
  and audio reorder commands come from the centralized order boundary.

Deferred:

- The schema is the practical source for manager conversion, but TypeScript
  effect config unions and DSP processor setters still remain separate
  representations. Adding a processor-level parameter can still require more
  than one code location.
- There is no literal round-trip back from DSP params to UI config; current tests
  verify schema coverage and expected conversion output instead.

Audit conclusion: #191 follow-up closure is acceptable for effect conversion,
readiness, and ordering ownership. Full one-location DSP/UI/type parameter
ownership remains deferred.

## #192 Introduce Mode Switching State Machine

Status: substantially accepted for lifecycle readiness and rollback semantics.

Implemented and covered:

- `mode-lifecycle-manager.ts` defines `ModePhase`, `ModeLifecycle`, and a
  `createModeManager()` state machine with observable snapshots via
  `useSyncExternalStore`.
- Mode transitions reject concurrent requests with "Mode transition in
  progress"; this is covered in `mode-lifecycle-manager.test.ts`.
- Activation waits for playback sessions to be ready and stays retryable on
  missing session state for single, multiple, and DJ modes.
- Managed-mode boot restoration recreates runtime sound IDs for restorable
  channel radios; DJ activation restores restorable deck radios through injected
  deck commands.
- Deactivation fades active sounds for 150ms, clears stale runtime errors,
  invokes channel cleanup, and checks for orphaned sounds.
- Failed activation rolls back to the previous active mode and does not commit
  the requested setting.
- `mode-select.tsx` now calls `modeManager.switchTo(value)` and disables mode
  controls while activation/deactivation is in progress.

Deferred:

- The state machine rejects concurrent transitions rather than queueing them.
  This satisfies the accepted "queued or rejected" behavior.
- Some legacy hydration/action helpers still exist as compatibility code, even
  though mode activation now handles restoration for the audited paths.
- Programmatic settings changes outside `mode-select.tsx` were not exhaustively
  proven beyond the current tests and code inspection.

Audit conclusion: #192 follow-up closure is acceptable for the lifecycle manager
semantics required by #200. Exhaustive removal of legacy hydration helpers and
all programmatic mode-change path coverage remains deferred.

## Final Disposition

No additional runtime code changes are required for issue #201. The current
state satisfies the audit deliverable by making the remaining deferred scope
explicit:

- Full `AudioManager` monolith decomposition is still deferred behind the
  `AudioEngineFacade` migration budget.
- Full playback action singleton removal and DJ action-file consolidation are
  still deferred.
- Full hook/query simplification across single and multiple mode is still
  deferred.
- Full one-location DSP/UI/type parameter ownership is still deferred.
- Exhaustive programmatic mode-change path coverage is still deferred.

The bounded follow-up closures #195 through #200 are accepted as coherent
migration slices with focused tests around the highest-risk behavior: session
radio migration, channel lifecycle cleanup, injectable DJ deck commands, facade
budget enforcement, effect ordering/readiness, and mode lifecycle rollback and
restoration.
