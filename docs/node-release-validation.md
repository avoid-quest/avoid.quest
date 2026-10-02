# Release follow-up validation — 2026-10-02

Tested the two follow-up layers based on #368 (`228a5ff4`). No merge or deployment was performed.

## Fixed

- canvas-5: immutable graph/environment pairs share compiled plans between playback, Canvas and Rack. A regression test checks the actual compiler invocation count and separate graph/environment variants.
- perf-3: confirmed five live parameter edits caused five full-session localStorage writes. TanStack DB paced optimistic mutations now throttle live writes to 250 ms, with final writes flushed on release, structural commits, mode exit, pagehide and backgrounding. Browser reproduction produced two writes for five edits and saved the final value on release. Failed-write tests verify rollback.
- perf-2: Node compiler, channel derivation and playback reconciliation are loaded on demand. Multiple migration remains synchronous before playback initialization; a differential test compares its channel records with the full compiler, including disabled stations and expired local files.
- Startup chunk regression: #368 bundled Vite's shared preload helper into openDAW Studio. Explicit Rolldown chunk-group priority keeps Studio lazy. The new build guard fails on #368 and passes on the follow-up.
- Discord container: fixed ARM64 Opus source compilation and switched from musl to Debian glibc because sodium-native has no matching ARM64 musl prebuild. The image builds; Opus encode/decode, sodium-native and Discord voice load successfully under the runtime user (uid 1001).
- Removed two stale, already-merged stacks from local gh-stack tracking. No remote stacks, branches or historical worktrees were deleted.

## Automated validation

Passed `bun run check`, `bun run typecheck`, `bun run test` (radio 2,498; platforms 283; error 17; Discord bot 14), `bun run --filter @avoid.quest/radio build` including `check:node-chunk`, and `bun run --filter @avoid.quest/web build`. Also ran #368's original radio suite (2,494 passing) and rebuilt its radio output for comparison.

Built with `docker build --progress=plain -f apps/discord-bot/Dockerfile -t avoid-quest-discord-bot:merge-check .`. Runtime smoke test constructed `OpusEncoder(48000, 2)`, encoded 3,840 PCM bytes, decoded them back, and loaded `sodium-native` and `@discordjs/voice`.

The sum of gzip sizes in the root/home manifest's static JavaScript dependency closure fell from 870.6 kB to 618.2 kB. This measures initial route dependencies and is not directly comparable to the earlier report's total startup metric.

## Browser validation

Chromium 152 / Electron 44 in T3 Code; desktop 1280×800/1000, phone viewport 390×844. Fixtures were seeded through the running app; gesture rows below distinguish synthetic input from native preview actions.

- NTS radio playback advanced in Node and Single; DJ Deck A played Lyl Radio. Node playback diagnostics reported the official openDAW Gate backend, one worklet and two monitoring channels, with the audio context running.
- Native Single/DJ/Node mode switches completed without surviving sounds from the previous mode.
- Native Vocoder Bands and Fold Oversample selections persisted numeric values (8 and 8).
- Synthetic 18 px pointer drag on the Vocoder carrier minimum moved 100 Hz to 200 Hz; synthetic double-click reset it to 100 Hz.
- Panned Split removal was refused with the centering message, leaving the node intact. Menu opening used synthetic Enter; Remove used the preview click tool.
- A synthetic run of 250 repeated ArrowRight events added one undo step and retained earlier history.
- The phone viewport had no document-level horizontal overflow and exposed the Split branch inspector. This does not verify physical touch or WebKit.
- Production preview rendered Single and DJ without fetching Node playback/compiler or openDAW Studio chunks. Switching to Node fetched its playback, graph and canvas chunks and rendered the starter patch.
- Sentry v11 with the shipped privacy options produced event and session envelopes through an in-memory transport and flushed successfully. This verifies SDK processing and transport handoff, not delivery to a live Sentry project.

## Still unverified

Physical iPhone/WebKit playback unlock and touch; microphone permission/capture; external output and CUE routing; MIDI hardware; audible FX quality; NAM model transfer/listening; live Spotify/provider renewal; real Sentry ingestion/sourcemap upload; Discord login/voice connection; x86 Docker runtime. Existing device acceptance gates remain pending in `apps/radio/src/components/radio/node/docs/acceptance.md`.

The old #366 worktree and the #367/#368 worktrees remain intact. #366's remote single-commit release-note requirement was preserved.
