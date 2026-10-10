# Node demo and Sentry follow-up — 2026-10-10

Baseline: `5f62eb9` (Radio 0.7.1). This pass covers every shipped node type,
representative interactions, real browser audio processing, and the two new
Sentry issues. It is not certification of every parameter combination or device.
The separate UX pass is intentionally outside this audio-fix change.

## Sentry

Queried `avoidquest/radio` in the EU region: nine issues seen in seven days,
two new unresolved issues. The other seven were already resolved. The last
24 hours contained two accepted error events, zero dropped error events, and
no warning/error log records in the queried log dataset.

- [RADIO-20](https://avoidquest.sentry.io/issues/RADIO-20): one production
  `InvalidAccessError` at 14:49:03 UTC. Monitoring cleanup tried to disconnect
  an edge already removed by source teardown. Reproduced with a real browser
  AudioContext and with both `disconnectSound` and `deleteSound` in regression
  tests. Cleanup now tolerates only the expected missing-edge error and still
  unregisters monitoring; unexpected errors continue to propagate.
- [RADIO-21](https://avoidquest.sentry.io/issues/RADIO-21): one production
  `AUDIO_PROCESSOR_FAILED` at 14:50:58 UTC, with RADIO-20 in its breadcrumbs.
  The event lacks the underlying worklet exception, so its historical trigger
  cannot be established conclusively. The demo independently reproduced a
  matching worklet failure when adding Stereo Split or Band Split:
  `apply_updates rejected a transaction (code 1)`. Of the isolated cell writes
  tested (dry, wet, index, label, gain, pan, mute, solo), only live label writes
  restarted the engine. Labels are now initialized before new cells are
  published and retained in authored configuration for subsequent renames.
  Audio parameters still update normally.

Five added regressions failed before their respective fixes and passed after.
The real WASM reproduction subsequently added and removed Delay, Split,
Stereo Split, and Band Split without a worklet replacement or error. It also
disconnected its native source before deleting the runtime sound successfully.
Sentry issue status was not manually changed; post-release telemetry remains
the check for recurrence.

## Demo coverage

Desktop Chromium 154 in T3 preview initially; Chromium 156 through Playwright
after the preview host became unavailable. Local Vite app, cross-origin
isolation enabled, Linux, desktop 1440×1000 and mobile viewport 390×844.
Fixtures used the running application's real palette, graph commits, source
loader, compiler, playback manager, and meters. Browser gestures and direct
application API calls are distinguished below.

All **43 shipped types** rendered. All **42 types with settings** were opened;
Merge deliberately has no settings. Synthetic keyboard changes on the first
available slider changed stored node data on 37 types. These checks cover a
representative control per node, not every control or range.

| Group | Nodes | Evidence |
| --- | --- | --- |
| Sources (4) | Station, Track, File, Audio input | All rendered and inspected. File playback/transport and live NTS Channel 1 exercised. Microphone success is user-reported. Remote Track provider resolution was not exercised end to end. |
| Outputs (2) | Speakers, Output device | Both rendered and inspected. Main output signal measured. Separate physical devices/CUE were unavailable. |
| Native effects (3) | Filter, Pan, Gain | Each passed signal through the native audio graph. |
| DSP effects (18) | Dattorro Reverb, Crusher, Fold, 7-Band EQ, Delay, Compressor, Stereo Tool, Tidal, Free Reverb, Gate, Waveshaper, Maximizer, Vocoder, Tone3000, Autotune, Pitch/Speed, Distortion, Limiter | Each passed finite, nonzero signal; bypass and re-enable exercised. The last three correctly used the compatibility backend, the other fifteen used official openDAW. Tone3000 used its default fallback without an external model. |
| Routing (4) | Split, Stereo Split, Band Split, Merge | Each split rejoined through Merge, compiled without issues, and passed nonzero signal through official openDAW. |
| Modulators (12) | Clock, Curve, ADSR, Follower, LFO, Macro, MIDI in, Multi-stage envelope, Randomiser, Shaped LFO, Slew, Steps | All ran together: four native and eight DSP, no native-backend warning or unapplied modulation. Follower received real file audio; MIDI used a synthetic CC. |

### Audio and interaction observations

- Loaded a generated 60-second, 440 Hz WAV through the real local-file loader,
  enabled looping, and started it through the browser Play button. Each of the
  21 effects produced 10–11 finite meter samples with nonzero peaks and no
  compiler issues. This verifies signal continuity, not subjective FX quality.
- Split, Stereo Split, and Band Split output peaks were approximately 0.0916,
  0.0647, and 0.0654. A corrected fixture with unique node IDs produced no
  missing-handle warnings. An earlier fixture reused an ID across node types,
  generating React Flow warnings that were test artifacts.
- File seek/cue/return-cue worked (cue about 10.15 s, returned about 10.30 s).
  Position stayed at 10.296845 s during a 350 ms pause and advanced after resume.
- Native keyboard Home/End on Speakers volume and browser clicks on Mute all /
  Unmute all produced zero/restored output. A native analyser at the master
  meter's source read 0 when volume was zero or muted and 0.06474 when restored.
  The displayed peak meter decays, so it was not used as an instantaneous
  silence assertion.
- LFO ranged approximately −0.985 to 0.968; Steps and Clock reached 0 and 1.
  Follower reached about 0.184. Macro and Slew reached 0.5. Synthetic MIDI
  CC 99/127 produced 0.779527559. ADSR and multi-stage envelope held at 0.5
  and 0.8, then released to zero. Curve, Randomiser, and Shaped LFO varied.
- LFO-to-Delay-feedback assignment applied without changing the authored
  feedback value of 0.5. Removing Delay, Undo, Redo, and Undo restored the
  expected graph. A self-loop was rejected with the connection guidance.
- Native Single → DJ → Node mode changes released official monitoring lanes
  (zero remaining monitoring channels). This was measured, not a physical
  listening test.
- Live NTS Channel 1 progressed from 2.536 to 3.535 s with null live duration,
  then paused. The 390×844 viewport had no document-level horizontal overflow.
- No unhandled page errors in the final sweeps. Remaining console warnings
  were the local feedback endpoint returning HTTP 502 and the existing React
  Flow attribution warning.

## Performance observation

Thirty add/remove cycles rotated through Split, Stereo Split, Band Split,
Delay, and Distortion while the file played. Monitoring channels returned to
zero after every removal; compatibility worklets returned to zero. The final
topology retained one source, two meter worklets, and one reusable official
engine worklet, without growth across cycles. Four meter listeners included
the probe's explicit extra subscription. No worklet crashes or page errors.

The headless run recorded 70 underrun events (186.62 ms) in about 17 seconds;
59 occurred in the first three cycles and the count stopped increasing after
cycle 10. This is a startup/load observation, not evidence of glitch-free
playback or a proven production performance regression. A real-device cold
start and long-session latency/CPU soak remain necessary. No speculative
performance rewrite was made based on headless timing alone.

## Automated validation

Commands were run from the repository root using Bun 1.4.2 / Node 24.21.0
through `mise exec bun@1.4.2 node@24.21.0 --`:

- `bun run check` — passed.
- `bun run typecheck` — six successful tasks.
- `bun run --filter @avoid.quest/radio test` — **3,250 passed**, zero failed,
  227 files (baseline: 3,245).
- `bun run --filter @avoid.quest/platforms test` — **339 passed**, zero failed.
- `bun run --filter @avoid.quest/radio build` — passed, including the guard
  that keeps React Flow in lazy client chunks.

No Cloudflare bindings changed, so local type regeneration was not needed.
No manual deploy/upload was run.

## Remaining acceptance gaps

- Independent microphone permission/lifecycle checks: the user has already
  manually verified microphone operation.
- Physical MIDI, separate audio output devices and CUE, system/tab capture
  picker, unplug/replug behavior, audible FX quality, device latency, and
  longer performance soak.
- Safari/iPhone playback unlock and physical touch; a Chromium phone viewport
  does not establish these.
- External NAM model download/transfer/listening and every remote provider's
  search, authentication, URL renewal, and failure modes. Platform unit tests
  passed but do not replace live service tests.
- Every parameter permutation and large simultaneous effect graphs.
- Production verification after release, including recurrence of RADIO-20/21.

The existing device acceptance checklist remains in
`apps/radio/src/components/radio/node/docs/acceptance.md`.
