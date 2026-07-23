# openDAW effects manual test checklist

Use a Chromium browser for the primary pass. Test both the local development
server and a local production build. Use headphones and keep the master volume
low while testing gain, feedback, distortion, and dynamics.

## Preflight and real audio

- [ ] Load the app over HTTPS or `http://localhost:3000` and confirm
      `window.crossOriginIsolated === true`.
- [ ] Confirm the document has
      `Cross-Origin-Opener-Policy: same-origin` and
      `Cross-Origin-Embedder-Policy: credentialless`.
- [ ] Load built-in NTS Channel 1 and Channel 2. Network requests must use
      `https://streams.radiomast.io/nts1` and
      `https://streams.radiomast.io/nts2`, not the historical
      `stream-relay-geo.ntslive.net` redirect.
- [ ] Let each NTS stream play long enough to see transport time, programme
      metadata, deck meters, and the master meter advance. Confirm there is no
      media-element CORS error.
- [ ] Confirm `/opendaw/processors.js`,
      `/opendaw/wasm-processor.js`, `/opendaw/wasm-offline-worker.js`, and
      `/opendaw/wasm/engine.wasm` return `200` with JavaScript or WASM MIME
      types as appropriate.
- [ ] While adding all 19 devices, confirm requested files beneath
      `/opendaw/wasm/plugins/` return `200` without CORS or MIME errors.
- [ ] Confirm the console has no `Workers are not installed`, `unwrap failed`,
      uncaught worklet, or repeated engine-initialization error after the
      current page load.
- [ ] Confirm no request uploads deck audio for processing.
- [ ] Confirm Pitch/Speed, Distortion, and Limiter remain available after the
      19 openDAW entries.

## Exact 19-device catalog

Add every entry to one deck. The chain header must report 19 effects, with one
instance of every label below. Enable and expand one at a time, change at least
the signature control listed, and confirm audio, transport, and meters continue.
Then bypass and re-enable it.

- [ ] **Dattorro Reverb** — Pre-delay, Decay, Dry, and Wet.
- [ ] **Crusher** — Bit Depth, Boost, and Auto Gain.
- [ ] **Fold** — Drive, Oversample, and Mix.
- [ ] **7-Band EQ** (`Revamp`) — High Pass plus one shelf and one bell band.
- [ ] **Delay** — Musical delay, millisecond timing, Feedback, Cross Feedback,
      filters, modulation, Dry, and Wet.
- [ ] **Compressor** — Threshold, Ratio, Attack, Release, Lookahead, and Auto
      Makeup.
- [ ] **Stereo Tool** — Stereo Width, Pan, pan law, polarity, and channel swap.
- [ ] **Tidal** — Depth, Slope, Symmetry, phase/channel offset, and musical
      division.
- [ ] **Free Reverb** (`Reverb`) — Pre-delay, Decay, damping/filtering, Dry,
      and Wet.
- [ ] **Gate** — Threshold, Attack, Hold, Release, Floor, and Inverse.
- [ ] **Waveshaper** — each Equation option plus input/output gain and Mix.
- [ ] **Maximizer** — Threshold and Lookahead.
- [ ] **Vocoder** — Carrier range, 8/12/16 bands, noise/self/external
      modulator modes.
- [ ] **Tone3000** (`Neural Amp`) — Local NAM model, input/output gain, Mono,
      and Mix. See the prerequisite below.
- [ ] **Werkstatt** — Pass Through plus all six official examples, source
      editor, declaration-driven controls, and runtime status. See the sample
      limit below.
- [ ] **Autotune** — Key, Scale, Amount, Retune, Manual shift, and Smooth.
- [ ] **FX Composite** — Chain A, Chain B, and Add parallel chain.
- [ ] **Stereo Split** — fixed Left and Right chains.
- [ ] **Frequency Split** — Bands and Crossover 1.

Top-level effects support drag reordering. After the catalog smoke test, move
three top-level effects, reload, and verify their new order. Nested children and
container branches do not currently have drag-reorder controls.

## Sidechain and tempo

- [ ] Play different real audio on Deck A and Deck B.
- [ ] On Deck A Compressor, choose Deck B under Sidechain input. Make a
      deliberately audible threshold/ratio change, then switch back to Internal
      input without stopping either deck.
- [ ] Repeat with Gate.
- [ ] On Vocoder, select External sidechain under Modulator. Confirm the
      Sidechain input control appears, choose Deck B, then return to Self.
- [ ] Stop, replace, and reload Deck B while it is selected as a sidechain.
      Deck A must remain recoverable and changing back to Internal input must
      restore normal operation. There is no dedicated sidechain-status badge,
      so verify with audio, meters, and the console.
- [ ] Set Synced effect tempo to a known value, such as 180 BPM. Test Delay and
      Tidal at multiple musical divisions while audio is playing.
- [ ] Reload and confirm the BPM and musical divisions persist. Changing tempo
      must not restart either stream.

## Containers and nested routing

- [ ] **FX Composite:** begin with Chain A and Chain B; add a third parallel
      chain. Rename it, add a different nested effect to each chain, and verify
      branch gain, pan, mute, solo, parent bypass, and overall dry/wet.
- [ ] Remove one FX Composite branch and confirm only that branch and its
      descendants disappear.
- [ ] **Stereo Split:** add different nested effects to the fixed Left and Right
      chains. Verify channel isolation with Stereo Tool or extreme branch pan,
      then verify parent bypass and mono compatibility.
- [ ] **Frequency Split:** switch between two, three, and four bands. At each
      size, add different nested effects, move each available crossover, and
      confirm ordered limits prevent crossovers from crossing.
- [ ] Add one container inside another container and then add a normal effect
      inside the nested container. Enable, edit, bypass, remove, and reload that
      tree; every child must occur exactly once.
- [ ] Confirm each child picker exposes the same 22 entries as the top-level
      picker.

Do not record nested drag reorder, branch reorder, cyclic drag rejection, or a
depth-limit message as passes: those controls are not implemented.

## Persistence, migration, and compatibility

- [ ] Build a tree containing all 19 openDAW entries, nested children,
      non-default branch state, sidechains, tempo, enabled state, dry/wet, and
      non-default parameters. Reload and confirm the persisted tree is restored.
- [ ] Start from a session produced by the previous radio release with
      Pitch/Speed, Distortion, Limiter, and a flat effect chain. Open the current
      app and confirm IDs, values, and order are retained and tempo defaults to
      120 BPM.
- [ ] Add Pitch/Speed, Distortion, or Limiter to a chain that already contains
      openDAW effects. This deliberately selects the compatibility runtime for
      the whole chain. Verify all effects remain present, ordered, editable,
      audible where applicable, and persistent after reload.
- [ ] Remove the last radio-only effect from that chain and confirm the
      stock-only chain reconnects without dropping state or stopping playback.

The radio has no playback-session export/import UI. Do not substitute the
settings/radio-collection export for this test. Migration and JSON round-trip
coverage is provided by the focused tests in the validation section.

## Tone3000 and Werkstatt prerequisites

- [ ] Provide a valid local `.nam` JSON model for the Tone3000 DSP test. The
      repository intentionally contains no model or credential.
- [ ] Select the model with the Local NAM model file input. Confirm
      `/opendaw/nam.wasm` loads, the UI reports the local filename, the model is
      restored after reload, and no Tone3000 credential/model request is made.
- [ ] Clear the model and verify recoverable pass-through.
- [ ] Select invalid JSON and a JSON array in separate attempts. Each must show
      a local validation message and leave unrelated audio/effects running.
- [ ] For Chrome automation, record Tone3000 DSP as unverified unless a valid,
      user-provided `.nam` fixture is available to the browser file-upload
      action. Picker presence and invalid-file recovery alone do not prove NAM
      processing.
- [ ] For Werkstatt, try Pass Through and all six official examples. Move every
      generated boolean/integer/linear/exponential control and confirm the
      device UUID remains stable and parameter-only edits do not recompile.
- [ ] Edit valid source and choose Compile source. Confirm status reaches Ready
      without a page refresh. Enter invalid source and confirm Error remains
      local, the last valid processor keeps running, and a later valid compile
      recovers.
- [ ] Add grouped `@param` declarations and confirm typed controls appear in
      declaration order. Duplicate labels must show a declaration error.
- [ ] Do not count `@sample` as working DSP. The disabled explanation is
      intentional: the current official audio-effect bridge does not forward
      samples. Legacy saved reference maps remain preserved.

## Failure recovery, PWA, and limits

- [ ] Block one openDAW worklet or WASM asset and reload. A compatibility-mode
      warning must appear and dry/compatibility playback must remain usable.
- [ ] Restore the asset and start a fresh app/controller lifetime without
      clearing saved state. Confirm the stored graph reconnects once.
- [ ] Install the PWA and reload under service-worker control. Confirm the
      service worker uses network-only fetches for same-origin openDAW assets
      and does not intercept cross-origin audio streams.
- [ ] Hard reload after a build change and confirm no stale engine, worklet,
      plugin, or NAM WASM is served. Offline launch is not an effects feature:
      the service worker intentionally has no asset cache.
- [ ] Leave both decks playing representative nested chains for at least
      15 minutes. Watch for repeated asset fetches, worklet errors, underruns,
      discontinuity, stuck meters, rising CPU, or unbounded memory growth.
- [ ] If testing more than four simultaneous stereo sources, expect the fifth
      official route to disable the shared official runtime and reconnect all
      sources through compatibility mode for that controller lifetime. Verify
      playback remains recoverable and the warning is visible.

## Validation commands

Run from the repository root:

```sh
bun run check
bun run typecheck
bun run --filter @avoid.quest/radio test
bun run --filter @avoid.quest/radio build
git diff --check
```

Focused coverage for the catalog, adapter, runtime, routing, persistence
migration, compatibility processor, and NTS URL normalization:

```sh
bun test \
  apps/radio/src/lib/audio/dsp/effects/opendaw-catalog-completeness.test.ts \
  apps/radio/src/lib/audio/manager/official-opendaw-effect-adapter.test.ts \
  apps/radio/src/lib/audio/manager/official-opendaw-runtime.test.ts \
  apps/radio/src/lib/audio/dsp/routing/effect-tree.test.ts \
  apps/radio/src/lib/audio/dsp/routing/effect-tree-routing-coverage.test.ts \
  apps/radio/src/lib/collections/playback-session-effect-migration.test.ts \
  apps/radio/src/lib/audio/dsp/processor-adapter-coverage.test.ts \
  apps/radio/src/lib/audio/playback/playback-input.test.ts
```

After the production build, verify the client output contains the stable
openDAW assets:

```sh
test -f apps/radio/dist/client/opendaw/processors.js
test -f apps/radio/dist/client/opendaw/wasm-processor.js
test -f apps/radio/dist/client/opendaw/wasm-offline-worker.js
test -f apps/radio/dist/client/opendaw/wasm/engine.wasm
test -f apps/radio/dist/client/opendaw/nam.wasm
find apps/radio/dist/client/opendaw/wasm/plugins -type f -name '*.wasm'
```

## Licensing note

The upstream terms observed during research are recorded in
[`OPENDAW_UPDATE_RESEARCH.md`](./OPENDAW_UPDATE_RESEARCH.md). This checklist
makes no legal conclusion and requires no external credentials or bundled model
assets.
