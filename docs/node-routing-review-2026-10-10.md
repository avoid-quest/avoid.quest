# Connected node routing review — 2026-10-10

Follow-up to `node-demo-validation-2026-10-10.md`. The earlier catalogue demo
was not proof of every connected topology. This review exercises actual signal
levels, branch controls, taps and native worklets.

## Confirmed defects corrected

| Defect | Evidence | Correction |
| --- | --- | --- |
| Two/three-band native splits discard high frequencies | 19 kHz RMS ~0.2547 instead of ~0.3536; factory has four cells | Match native cell count to authored bands, including shrink/grow and retained child effects |
| Direct follower cable ignores its trim on dry contribution and can falsely glow while muted | Offline routing fails at mixes 0 and 0.5, passes at 1 | Apply the follower cable trim/mute to both contributions and report silence to the canvas |
| Rejoined Split/Stereo Split rejects internal sidechain/follower taps | Single audible branch plus follower fails `key-enclosed` | Open supported split regions at the tap while keeping the Merge sum |

## Coverage

- Compiler/routing tests: nested regions, shared Merge sums, branch/cable gain
  and pan, mute/solo, dry/wet/input/output trims, port removal and retirement
  fades, key-only/follower-only branches, source deletion and latency planning.
- Added rendered comparisons: follower versus sidechain at mixes 0/0.5/1;
  post-effect follower; tap removal/reconnection; post-Merge follower; internal
  taps before Merge; Stereo Split left-port isolation; single audible branch;
  follower mute and dry-share allocation.
- Real native engine: 2/3/4-band shrink/grow, 997/8111/19000 Hz level checks,
  plus stage-versus-native sums at six frequencies (residual below −152 dBFS).
- Real production modulation worklet fed by RoutingGraph: expected follower
  levels at all three mix settings, cable gain, mute, disconnect/reconnect.
- Real native compressor with separate key: program RMS 0.03538 with silent
  key, 0.003014 with active key (~21.4 dB ducking), 0.03527 after key mute,
  0.02407 after key removal (internal detector), 0.003015 after reconnection.
- Existing modulation coverage also exercises stereo energy without phase
  cancellation, attack/release, MIDI/clock/envelope behavior, runtime restart,
  native/compatibility delivery, and more than eight follower inputs.

## Deliberate limits

Divergent Band Split and taps inside its bands remain unavailable pending the
full measurements in
`../apps/radio/src/components/radio/node/docs/split-routing-measurements.md`.
The summed-output mismatch is fixed, but per-port tests, the full mix/bypass
matrix and click counts have not all been measured. Use the native rejoined
Band Split and tap after its Merge.

Opening a Split for a tap can consume more monitoring channels. Capacity
planning and fallback remain covered by automated tests; this is not a new
claim that every large topology uses native processing.

No physical microphone retest was needed (the user already confirmed it), and
no physical multi-device listening/latency test was performed. Synthetic
signals exercise routing; they do not certify every device, parameter
combination, third-party media item or live station.

The separate UX PR covers search sources, Starter, scroll behavior and the
inspector. Its validation is recorded separately from this runtime change.

## Validation

Run from the repository root with Bun 1.4.2 and Node 24.21.0:

- `bun run check` — passed, 921 files.
- `bun run typecheck` — passed, all six workspaces.
- `bun run --filter @avoid.quest/radio test` — 3,264 passed, zero failed.
- `bun run --filter @avoid.quest/radio build` — passed, including the lazy
  React Flow chunk check. Local source-map upload was skipped because Sentry
  upload credentials are absent; compilation and bundle validation completed.

No deployment command was run.
