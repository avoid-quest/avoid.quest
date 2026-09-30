# Node mode proposal

Question: what should replace Multiple mode so that users can combine several sources and
outputs through FX, in series or in parallel, without leaving the one-product feel that
Single and DJ already have?

Verdict: a React Flow (`@xyflow/react` 12.x) patch canvas whose compiler lowers the graph onto
the engine the app already runs, with a thin native bus layer at the one seam where a lane's
fader meets the main bus. The first release is today's Multiple drawn as nodes; each later
PR adds only node types the compiler can reconcile without clicks on desktop and mobile
Safari. Single and DJ are not touched.

This is design only. No code has changed. Anchors come from the codebase maps and from direct
checks of this worktree.

## 1. Verdict

Node mode replaces Multiple with a patch canvas built on React Flow. Its compiler turns a
user's graph of stations, FX, buses, control and outputs into the pieces the engine already
runs reliably:

- one managed sound per source lane;
- each lane's series and parallel FX lowered to the existing `EffectConfig` tree;
- a thin native `GainNode` bus layer inserted at the one seam where a lane's fader output
  meets the main bus.

The first release is exactly today's Multiple, drawn as nodes. Each later PR adds node types
that the compiler can already prove it can reconcile without clicks on desktop and on mobile
Safari.

Ship labels used below: **v1** is PRs 2-4, **v2** is PRs 5-7, **later** is PR 8 (§10).

## 2. Mental model

**First 30 seconds.** A Multiple user switching to Node sees their mix as a patch. Each
station they had is a compact card on the left: station name, now-playing line, play button
and volume. Grey cables run from each card into a **Speakers** node on the right, which holds
Play all (N), the master volume and a small stereo meter. Space still plays or pauses
everything. A single hint line under the canvas reads "Drag a cable to empty space to add a
node".

A new user, or one with no stored node session, starts from the **Starter** patch instead:
one empty Station slot, its body the station search, wired to Speakers. A station picked from
the search bar fills that slot rather than landing beside it. Until a source holds a station
the canvas hint says what to do first: "Search a station in the slot, or press / to add a
node" ("tap +" on a phone; "Search to add a station" when there is no slot). The richer
templates stay in the Templates menu and the palette.

Pressing `/`, double-clicking the canvas, or dropping a cable on empty space opens the
palette, and a station picked there is wired in ahead of time. Pressing play makes the
cables carrying signal brighten with their live level.

On a phone the same patch opens on the **Stage** tab: each source with play and volume, and
the master. Rack and Patch are one tap away (§6).

**The one memorable thing: the Dial.** Drop a Dial node between your stations and Speakers
and you get one big knob. Turning it tunes across the connected stations like an analogue
receiver, with band-passed static between them. Patch a Clock into it and it becomes a
**Radio Dérive**: the patch wanders between stations on its own, each hop tuning through
static. It needs no new DSP: it is edge gains on a sum bus plus one looping noise buffer
(§4). New users start from the "Dial" template once it ships in PR 6. Until then, and for
every migrated user, the start is the exact Multiple layout plus that one hint.

## 3. Node catalogue

Handle ids encode signal kind (§5.4): `audio`, `sidechain` (an audio input with a narrower
rule), `control` (0..1 or -1..1 modulation, plus pulses) and `midi`. Every FX node also
carries the four universal wrapper params: enabled, dryWet, inputGain and outputGain
(`apps/radio/src/lib/audio/dsp/effects/universal-params.ts:1-44`).

### Sources

| Category | Name | Inputs | Outputs | Params | For | Ship |
|---|---|---|---|---|---|---|
| Source | Station | control: volume, pan, station | audio; control: song-change (pulse), title-hash (v2) | radio ref (snapshot), volume, muted, play | A saved or session station as a lane: one managed sound through `createManagedSound` (`apps/radio/src/lib/playback-actions-shared.ts:85-104`). **Its empty state is the search**: with no station, the body is an inline `SearchField`, and the chosen result fills the slot. A pasted radio stream link becomes a session station; a pasted platform link loads and hands off to a Track (a session radio keeps the green `#00d084/40` stripe; session radios are tab-scoped, `apps/radio/src/lib/collections/session-radios.ts:14-37`). There is no separate Search node | v1 |
| Source | File | control: volume (v2) | audio | radio (like a Station's), volume, muted, play | One of the Source family with Station and Track: same data, frame and strip slot (`components/radio/node/source-node-frame.tsx`). A local file through a `blob:` URL (`apps/radio/src/lib/audio/file-metadata.ts:74-76`) or a static audio URL (MP3, M3U, PLS) resolved in the browser (`lib/audio/client-static-audio-resolver.ts`). Its empty body is DJ's `FileForm`. Restore skips local files (`isRestorableRadio`), and a local file's lane is live only for object URLs picked in this page (`lib/node-graph/sources.ts`), so after a reload the File keeps its name, has no lane and says "Pick the file again". A URL survives the reload. Albums and M3U playlists advance to the next track at the end of one | v1 |
| Source | Audio input (`deviceIn`, DJ's word) | none | audio | device, channel pair of the first 2 channels, echo cancellation, volume, mute, Go live | `createDeviceSource` (`apps/radio/src/lib/audio/playback/device-source.ts:581`) via `AudioManager.playDeviceSound`, getUserMedia → splitter/merger. The start is DJ's own, shared as `apps/radio/src/lib/device-input-playback.ts` (`startDeviceInput`: `playDeviceSound(soundId, deviceId, { echoCancellation })`, then `setDeviceChannelSelection`). An input with no device has no lane, like an empty Station. Its channel carries DJ's device-input radio (`dj-library-sources.ts`), and restore skips it (`isRestorableRadio`), so a reload never opens the mic: only Go live does. Realtime path, so it skips the main delay (`apps/radio/src/lib/audio/routing/browser-output-adapter.ts:39-42`). Not a stream, so the playing budget ignores it. Its body: Allow microphone (a gesture), "Microphone blocked…", the device select with Refresh, the channel select, "Unplugged: plug it back in or pick another" (the lane pauses), Off / Live with Go live and Mute, and while it reaches an output an amber "Use headphones: a mic into speakers can howl" with an Echo cancellation switch. It is never wired on its own when added | v1 |
| Source | Track (`platform`) | control: volume (v2) | audio | radio (like a Station's), search chip, volume, muted, play | A YouTube, SoundCloud or Bandcamp track, album or playlist. Its empty body is DJ's `ExternalSearch`, unlocked ("Search all") or locked by a platform chip taken from `PLATFORM_SOURCE_DEFINITIONS`; a pick or a pasted link loads through `useDjTrackLoad`, and a `yt:` track is resolved first. A radio link hands off: filling any Source with another kind of radio turns it into the one that plays it, in place (`setSourceRadio`). `validateRadioForMode` allows platform radios in `"node"` (Single stays refused). An expired stream is renewed through DJ's refresh, shared as `lib/platform-stream-refresh.ts`, and resumes at its position. At the end of a track in an album or playlist the lane loads `findNextTrack`; the inspector lists the tracklist (DJ's `TracklistView`) | v1 |
| Source | Static | control: level | audio | colour (white or pink), bandwidth | Looping noise `AudioBufferSourceNode` → Biquad bandpass. Native and cheap on Safari. Used by the Dial and the roulette bridge | v2 |

**Channel strips.** Every Station, Track, File and Audio input has a channel strip
(`data.strip`, schema v2), shown compact on its node body and Rack row (meter, M and S, pan
knob, beside the existing `VolumeControl`, and a button that opens the full strip) and in
full in the inspector, which now inspects every source. The strip is presentational
(`components/radio/node/source-strip.tsx`, props only), wired to the patch by
`node-source-strip.tsx`; DJ's `DeckChannelStrip` renders its pan and speed knobs from the
same pieces. What each kind shows is one table (`STRIP_CONTROLS`), so a control a kind
cannot use is absent, never disabled:

| Kind | Common | Adds |
|---|---|---|
| Station | meter, trim (-24 to +12 dB), pan, M, S | read-only stream details: buffering (runtime `isBuffering`), format (HLS or progressive, DJ's rule, now `streamFormatOf` in `lib/source-strip.ts`), bitrate from now playing, else from Radio Browser, and Radio Browser's codec, both now kept on discovery (`RadioBrowserMetadata.codec`/`bitrate`) |
| Track, File | same | speed 0.5–2x with key lock (`preservesPitch`, on by default), a seek bar with position and duration (DJ's `SeekableProgress`), loop (whole-track repeat at the end), Set cue and Cue (a stored position and a media-element seek), cue listen (pre-fader on the headphone cue bus, shown only when a cue output is set and `setSinkId` exists) |
| Audio input | same, the meter labelled Input | Monitor (Go live), the channel pair and echo cancellation |

The compiler folds the strip in: trim multiplies into each exit's `EdgePlan.gain` like an
in-lane Gain, strip pan adds to the lane's Pan node, clamped, any solo mutes the exits of
every unsoloed live lane, and a Track's or File's speed, key lock and loop become
`LanePlan.transport` (cue listen `LanePlan.cueListen`). The fader and mute stay the source's
own, so trim and solo never write the volume controller. The strip calls DJ decks and Node
lanes share live in `lib/source-strip.ts` (`setPlaybackRate`, `setPreservesPitch`,
`seekSound`, `repeatAtEnd`). Limits: the meter taps the sound after its fader, so it does not
show trim, cable gains or solo; cue jumps are media-element seeks, not sample-accurate; loop is
the whole track, not an A–B region; live radio and inputs have no speed, seek, loop or cue.
Monitor is written as it goes live but never restored: a loaded patch has every Monitor off.

The Station's control inputs appear when Control ships (PR 6). The `station` input and the
song-change and title-hash outputs power roulette and Dérive (§4). Metadata polling stays
gated to playing stations, as in Multiple (`apps/radio/src/lib/hooks/use-radio-metadata.ts`
enables its `refetchInterval` only while enabled, :151-215).

### FX: 22 effect types, plus the native strip

A lane maps FX nodes onto its native strip first (Pan → StereoPanner, Filter → BiquadFilter;
`apps/radio/src/lib/audio/manager/audio-manager-types.ts:42-55`). Everything else lowers into
the lane's `EffectConfig` tree. Type ids come from
`apps/radio/src/lib/audio/dsp/effects/types.ts:21-51`, and param keys from the four
`effect-definitions-*.ts` family files. v1 ships 21 of the 22 types; Werkstatt waits for PR 8.

| Category | Name (type) | Inputs | Outputs | Params (key ones; full set via EffectParams) | For | Ship |
|---|---|---|---|---|---|---|
| FX native | Filter (lane BiquadFilter) | audio; control: cutoff | audio | type HP/LP, cutoff | Native, AudioParam-modulatable. At most one per lane, directly after the source | v1 |
| FX native | Pan (lane StereoPanner) | audio; control: pan | audio | pan | Native, AudioParam-modulatable. At most one per lane | v1 |
| FX native | Gain | audio; control: gain | audio | gain dB | An edge-level trim. Compiles to an edge gain, not a DSP stage | v1 |
| FX | Free Reverb (`cheapReverb`) | audio | audio | decay, preDelay, damp, filter, dry, wet | Room | v1 |
| FX | Dattorro Reverb (`plateReverb`) | audio | audio | preDelayMillis, bandwidth, diffusion, decay, damping, excursion, dry/wet | Plate | v1 |
| FX | Delay (`delay`) | audio | audio | delayMusical/Millis, pre L/R, feedback, cross, filter, lfoSpeed/Depth, dry/wet | Echo; tempo-synced to session `tempo` (`playback-sessions.ts:283`) | v1 |
| FX | Tidal (`tidal`) | audio | audio | rateDivision, depth, slope, symmetry, offset, channelOffset | Tremolo or auto-pan | v1 |
| FX | Compressor (`compressor`) | audio, **sidechain** | audio | threshold, ratio, attack, release, knee, makeup, mix, lookahead, auto* | Glue, and ducking via sidechain (§5.3 step 7) | v1 |
| FX | Gate (`gate`) | audio, **sidechain** | audio | threshold, return, attack, hold, release, floor, inverse | Keyed gating | v1 |
| FX | Limiter (`limiter`, radio-native) | audio | audio | threshold | Safety. Forces the lane onto the compatibility backend | v1 |
| FX | Maximizer (`maximizer`) | audio | audio | threshold, lookaheadEnabled | Loudness | v1 |
| FX | Vocoder (`vocoder`) | audio (carrier), **sidechain** (modulator) | audio | bandCount, modulatorSource ("External sidechain", `effect-definition-shared.ts:77`), carrier/modulator min/max freq, qStart/qEnd, envAttack/Release, gain, mix | Station talks through another station | v1 |
| FX | Crusher (`crusher`) | audio | audio | crush, bitDepth, boost, autoGain | Lo-fi | v1 |
| FX | Fold (`fold`) | audio | audio | amount, volume, oversample, autoGain | Wavefolding | v1 |
| FX | Distortion (`distortion`, radio-native) | audio | audio | amount, oversample | Drive. Forces compatibility | v1 |
| FX | Waveshaper (`waveshaper`) | audio | audio | equation, deviceInputGain, deviceOutputGain, mix | Custom curve | v1 |
| FX | 7-Band EQ (`revamp`) | audio | audio | 7 bands (RevampParams + eq-curve visualisation) | Tone | v1 |
| FX | Stereo Tool (`stereoTool`) | audio | audio | volume, stereo, panning, panLaw, invertL/R, swap | Width | v1 |
| FX | Tone3000 (`neuralAmp`) | audio | audio | input, output, mono, mix, model (Tone3000ModelParams) | Amp models. NAM models are already externalised at init | v1 |
| FX | Autotune (`autotune`) | audio | audio | key, scale, amount, retuneAmount, shift, smooth | Pitch correction | v1 |
| FX | Pitch/Speed (`pitchShifter`, radio-native) | audio | audio | pitchFactor | Pitch. Forces compatibility | v1 |
| FX | Werkstatt (`werkstatt`) | audio | audio | script (WerkstattParams) | Code node. openDAW-only (`official-opendaw-runtime.ts:634-681`); disabled with a reason when the lane is not on the official backend | later |
| Routing (container) | Split (`fxComposite`) | audio | audio ×2-4 (branches) | per-branch gain, pan, mute, solo | Parallel copy. Lowers to fxComposite when its branches reconverge in one Merge inside the same lane | v1 |
| Routing (container) | Stereo Split (`stereoSplit`) | audio | audio L, audio R | per-branch gain, pan, mute, solo | Process L and R separately | v1 |
| Routing (container) | Band Split (`frequencySplit`) | audio | audio ×2-4 | crossoverFrequencies (increasing), per-band gain, pan, mute, solo | Multiband. 2-4 bands, depth ≤ 8 (`apps/radio/src/lib/audio/dsp/routing/effect-tree.ts:9-41`) | v1 |

### Routing

| Name | Inputs | Outputs | Params | For | Ship |
|---|---|---|---|---|---|
| Merge | audio ×N (N ≤ 8) | audio | per-input gain, mute, solo | Closes a Split inside a lane (becomes a container) or sums lanes (becomes a **bus**). The compiler decides which, and shows it as a badge ("in-lane" or "bus") | v1 in-lane, v2 bus |
| Crossfade | audio A, audio B; control: position | audio | position, curve (equal-power default, `CrossfadeCurve`, `crossfade.ts:12`) | Two-way blend on bus input edge gains, never on the lane fader (§5) | v2 |
| Send | audio | audio (to Return) | send level, pre/post | Aux send. An edge gain from a lane or bus output into a Return bus | v2 |
| Return | audio ×N | audio | level, mute | Shared FX bus (for example one reverb for several stations) | v2 |
| Mute / Solo | audio | audio | mute, solo | Explicit per-path gate. Solo is evaluated per bus | v2 |
| Dial | audio ×2-8; control: tune | audio | tune (macro), static level, width | Radio-dial crossfade across N inputs, with static in the gaps (§4) | v2 |
| Loop | audio in, audio return | audio | time (≥ 128 frames, one render quantum), feedback ≤ 0.95, tone | The only legal way to close an audio cycle. Compiles to `DelayNode` → DC-block highpass → soft-clip `WaveShaperNode` → feedback Gain between buses, with an RMS guard (§5.7) | v2 |
| Tape Warp | audio; control: time; control: freeze (pulse) | audio | time 0-30 s, feedback | A large `DelayNode` whose modulated `delayTime` scrubs and warps pitch. Freeze sets feedback to 1 and input to 0, a live looper of what was just on air | v2 |

### Control

| Name | Inputs | Outputs | Params | For | Ship |
|---|---|---|---|---|---|
| Macro knob | midi (optional) | control ×N | value; per-cable `MidiTransform` (invert, min, max, curve; `apps/radio/src/lib/midi/types.ts:12-27`) | One knob drives many params through `applyTransform` and the existing transform editor. Also the MIDI-learn anchor | v2 |
| LFO | control: rate | control | shape, rate (free or synced to session tempo), depth, bipolar, phase | Native `OscillatorNode` → depth gain → AudioParam when the target is native; otherwise a 30 Hz param stream | v2 |
| Clock | none | control (pulse) | bpm (defaults to session `tempo`), division | Drives Randomiser, roulette and Dérive | v2 |
| Randomiser | control: trigger | control | range, slew, seed | Drift or jumps | v2 |
| Follower | audio | control | attack, release, gain | Audio-to-control bridge (the Bespoke leveltocv idea), fed by MeterService levels (`subscribeMeter`, `meter-service.ts:123`) | v2 |
| Title trigger | control: title-hash or song-change from a Station | control (pulse or gate) | regex, hold | Fires when now-playing metadata matches, e.g. `/news\|advert/i` (§4) | v2 |
| Sundial | none | control: day-phase; control: at-time (pulse) | times, ease | Wall-clock time as an input ("dusk opens the reverb") | v2 |
| MIDI in | none | midi | device, channel | A visible projection of MIDI mappings: a cable **is** a `node:<id>:…` mapping, and deleting the cable clears it | v2 |

### Outputs

| Name | Inputs | Outputs | Params | For | Ship |
|---|---|---|---|---|---|
| Speakers | audio ×N | none | Play all / Pause all (N), master volume and mute, meter | Main bus through `OutputRouting.connectMain` (`apps/radio/src/lib/output-routing.ts:610-624`). Its gain is session `masterVolume`, applied as the global volume (`applySessionMasterVolume`, `apps/radio/src/lib/playback-actions-shared.ts:71-76`). Exactly one per graph | v1 |
| Scope | audio | none | mode (level, spectrum), freeze | MeterService tap on any bus or lane (`apps/radio/src/lib/audio/manager/meter-service.ts:44-82`). Spectrum can later read the compatibility `ANALYSIS_DATA` (`processor.ts:333`), which nothing consumes today | v2 |
| Headphones (CUE) | audio | none | level | `registerCueDeck("node:<id>", tap)` (`apps/radio/src/lib/output-routing.ts:592-608`). Hidden where setSinkId is missing | v2 |
| Output device (`deviceOut`) | audio ×N | none | device, mute | One more output beside Speakers: `apps/radio/src/lib/audio/routing/node-device-sinks.ts` builds one GainNode → MediaStreamDestination → `<audio>.setSinkId(deviceId)` per node, the CUE sink's pattern (`browser-output-adapter.ts:129-156`), when a send first connects (inside a play). Not sample-aligned with Speakers, and the main delay does not apply. One node a device: a second on the same device is refused ("This output already has a module"). With no device picked its cables stay silent. Where it can't play, its cables play through Speakers and its body says so: "This browser can't choose an output, playing through Speakers" (no `setSinkId`), "Unplugged, playing through Speakers", or the `setSinkId` error. "Same device as Speakers" when it names the main output setting. The palette offers one per listed output, none where `isSinkIdSupported()` is false | v1 |
| Recorder | audio | none | arm, format (webm/opus, or mp4 on Safari), max minutes | MediaStreamDestination → MediaRecorder → download. New code: nothing in `src` uses MediaRecorder today | v2 |

## 4. Wacky features

1. **The Dial.** One knob tunes across N stations, with band-passed static swelling between
   them. *Why it's cheap:* the stations sum on a native bus, the knob writes N edge-gain
   AudioParams through a triangular window function, and static is one looping
   `AudioBufferSourceNode`. There is no worklet, so it behaves the same on Safari's
   compatibility path.
2. **Radio Dérive and station roulette.** Clock → Randomiser → a Station's `station` input
   makes the node hop to a random saved station every N bars. Each hop tunes through a burst
   of band-passed Static, so it sounds like turning a dial. *Why it's cheap:* it reuses Single
   mode's active/standby channel pattern (`SINGLE_ACTIVE_CHANNEL_ID`/`SINGLE_STANDBY_CHANNEL_ID`,
   `apps/radio/src/lib/collections/playback-sessions.ts:41-42`), equal-power `crossfade()`
   (`apps/radio/src/lib/audio/manager/crossfade.ts:142`), and the Dial's static bus. The pool
   comes from saved stations or unified search (`apps/radio/src/lib/hooks/use-unified-radio-search.ts`).
3. **Weather front.** A slow LFO patched into Crossfade position gives a mix that drifts
   between two cities over minutes. *Why it's cheap:* the equal-power cos/sin curve that
   `apps/radio/src/lib/dj-crossfade.ts:1-8` computes on the main thread becomes two native
   `WaveShaperNode` curves between the LFO and the two edge gains, so there is zero
   main-thread work and it is sample-accurate.
4. **Talk-over.** A key cable into a Compressor on a music lane ducks the music when the
   keyed channel speaks: a talk station in v1, the Mic from PR 7. *Why it's cheap:* sidechain
   is already a cross-channel edge on both backends (compatibility: filter → worklet input 1,
   `apps/radio/src/lib/audio/manager/effects-controller.ts:322-336`; openDAW: a sideChain
   pointer, `official-opendaw-effect-adapter.ts:815-828`). The cable writes
   `effect.sidechain.channelId` on the Compressor config, and `channel-effects.ts:96-146`
   derives `sidechainSoundId` from it (§5.3 step 7).
5. **Frankenstation.** The bass of a Lagos station, the mids of a Tokyo talk station and the
   air of an Icelandic ambient stream. *Why it's cheap:* three lanes, each with its native
   BiquadFilter set to a band (`audio-manager-types.ts:42-55`) or a Band Split with one band
   soloed, into one Merge bus. Only existing primitives.
6. **Doppelgänger.** Duplicate a station node. The two copies drift apart by a few hundred ms
   and phase against each other, and a Nudge knob (Delay FX, dry 0) tunes the comb. *Why
   it's cheap:* every source is its own HTMLAudioElement with its own buffer
   (`apps/radio/src/lib/audio/playback/playback-source-factory.ts:7-13`), so the drift comes
   free.
7. **Song-change triggers and title hash.** Every Station emits a pulse when its ICY title
   changes, plus a control value that is a stable hash of the title. Re-roll the Dérive on
   each new song, give each song its own deterministic delay time, or feed a Title trigger
   with `/news|advert/i` to crossfade away when the news starts. *Why it's cheap:* the
   metadata poll already runs while a station plays (`use-radio-metadata.ts`, with Latin-1
   decoding fixed in 4f555a0). The node compares successive titles on the main thread; no
   polling is added for stopped stations.
8. **Tape Warp.** A 30-second `DelayNode` with an LFO on `delayTime` turns live radio into a
   warbling cassette, and Freeze makes a 30-second live looper of whatever was just on air.
   *Why it's cheap:* the same primitive as the main output delay
   (`browser-output-adapter.ts:13-42`) at a larger `maxDelayTime`, in the native bus layer,
   so audio-rate modulation is free.
9. **Sundial.** Time of day is an input. Sunrise slowly opens a Filter, and after 23:00 the
   Dérive slows down and the patch drifts toward ambient. *Why it's cheap:* a main-thread
   control source mapping the wall clock to 0..1. No DSP.
10. **Cables that breathe.** Live audio cables thicken and turn emerald with their level, and
    flash red on clip. *Why it's cheap:* MeterService already taps each sound post-fader
    (`audio-manager.ts:467-474`) and can meter any node (`setSoundSource`,
    `meter-service.ts:129`). The edge writes a CSS variable in rAF, with no React render.
11. **Record the séance.** A Recorder node on any bus captures that point in the patch, not
    only the master. *Why it's cheap:* it is the same MediaStreamDestination pattern the CUE
    sink already uses (`browser-output-adapter.ts:141-150`).

## 5. Engine design

### 5.1 What the engine can reliably do, and the resulting rules

- **Per-sound FX slot.** Each sound has one input and one output, and runs a series-parallel
  `EffectConfig` tree that works on both backends
  (`apps/radio/src/lib/audio/manager/effects-controller.ts:394-457`,
  `apps/radio/src/lib/audio/dsp/routing/effect-chain.ts:175-257`,
  `apps/radio/src/lib/audio/dsp/effects/container-effects.ts:356-407`). **Rule: all DSP lives
  in lanes or buses as `EffectConfig` trees. Node mode adds no new DSP engine.**
- **Single summing point.** The only summing point today is `OutputRouting.connectMain`
  (`output-routing.ts:610-624`), and each sound's fader output reaches it through the
  `connectMainOutput` callback at `apps/radio/src/lib/audio/manager/audio-manager.ts:467-468`,
  with the meter on `nodes.gain`. **Rule: cross-lane summing, sends and multiple outputs live
  in one new native layer inserted at that callback.** It uses GainNode, DelayNode,
  BiquadFilterNode, WaveShaperNode, ConstantSourceNode and OscillatorNode only, all of which
  work on every browser the app supports.
- **Fader ownership.** `nodes.gain` is owned by VolumeController and master volume
  (`apps/radio/src/lib/audio/manager/volume-controller.ts:120-170`). **Rule: the compiler
  never writes a lane fader.** Crossfades, mutes and the Dial act on edge gains downstream of
  it. Because buses carry no fader, global master volume scales every lane once and never
  twice, which keeps `setManagedSessionMasterVolume` semantics intact
  (`managed-playback-internals.ts:204-215`).
- **Gesture-synchronous connection.** The first play must connect synchronously inside the
  gesture; the shell connects before the effects await and falls back dry
  (`apps/radio/src/lib/audio/manager/audio-manager-graph.ts:148-187`). **Rule: bus nodes and
  edges are created synchronously and silent.** Only effects runtimes load asynchronously,
  behind the existing muted lane.
- **openDAW capacity.** openDAW takes at most 8 monitoring channels, i.e. 4 stereo sounds
  (`MAX_MONITORING_CHANNELS = 8`,
  `apps/radio/src/lib/audio/manager/official-opendaw-runtime.ts:26,333-407`), and needs
  cross-origin isolation (`effects-controller.ts:676-682`). A bus with FX consumes 2 of those
  channels like any sound. **Rule: the compiler predicts the backend for each lane and bus
  and shows a small `compat` badge. It never assumes openDAW.** Safari is treated as
  compatibility-only until verified. An optional per-session backend policy (§5.8) removes
  the mixed-backend case.

### 5.2 Seam files

New files, all pure except the last three:

| File | Role |
|---|---|
| `apps/radio/src/lib/node-graph/schema.ts` | Versioned Zod `NodeGraph` (§8) plus `migrateNodeGraph(raw)` |
| `apps/radio/src/lib/node-graph/catalogue.ts` | `NODE_DEFINITIONS`: ports `{id, kind, direction, max}`, `ship` flag, and for FX a link to `EFFECT_DEFINITIONS`/`createDefaultEffectConfig` (`apps/radio/src/lib/audio/dsp/effects/registry.ts:21-108`) |
| `apps/radio/src/lib/node-graph/validate.ts` | Port-kind check, Tarjan SCC cycle check, per-port limits, budgets. Returns `Issue[]` keyed by node or edge id |
| `apps/radio/src/lib/node-graph/compile.ts` | `compile(graph, env) → EnginePlan` (lanes, buses, edges, sinks, modulations) |
| `apps/radio/src/lib/node-graph/reconcile.ts` | `diff(prev: EnginePlan, next: EnginePlan) → Op[]` |
| `apps/radio/src/lib/node-graph/node-store.ts` | `@tanstack/react-store` `Store` holding the graph document, selection and the undo stack, following `apps/radio/src/lib/stores/playback-runtime-store.ts`. React Flow is controlled from it |
| `apps/radio/src/lib/node-graph/signal-store.ts` | A separate TanStack `Store` of per-id level buffers. The rAF loop reads it directly; React never subscribes to it at meter rate |
| `apps/radio/src/lib/audio/routing/node-bus-graph.ts` | Native bus layer: lane outs, buses, edge gains, Loop and Tape Warp, sinks, native modulators |
| `apps/radio/src/lib/node-playback.ts` | Replaces `apps/radio/src/lib/multiple-playback.ts`. Applies `Op[]` and provides activate/deactivate |
| `apps/radio/src/lib/node-graph/sources.ts` | Which Source node holds a radio (Station, Track, File), and whether a local file's object URL still plays in this page |
| `apps/radio/src/lib/node-source-loaders.ts` | Fills a Source through DJ's loaders: platform items, local files, static audio URLs, pasted streams as session stations |
| `apps/radio/src/lib/platform-stream-refresh.ts` | DJ's stream refresh (`getRefreshRequest` and the refresh call) and `yt:` track resolution, shared by DJ decks and Node lanes |

`apps/radio/src` never imports zustand today; the `zustand ^5.0.15` line in
`apps/radio/package.json:53` is unused. Holding node state in TanStack Store follows the house
pattern, so the app never touches the zustand 4 that React Flow 12 bundles, and the zustand
4/5 hazard (#5685) cannot arise from app code.

There are two engine changes, both additive:

1. **Lane outputs (PR 4).** `AudioManager` gains `setSoundOutputConnector(soundId, connect |
   null)`, consulted at `audio-manager.ts:467-468` instead of always calling
   `this.output.connectMain`. The node engine registers a connector per lane that wires
   `nodes.gain` → the lane's stable `laneOut` GainNode inside `NodeBusGraph`. That connection
   happens once per sound. After it, every topology change happens downstream in
   `NodeBusGraph`, so the audio-manager, DJ and Single paths are untouched. As built
   (`node-lane-outputs.ts`), laneOut carries only the layout duck and fans out into one send
   GainNode per output the lane reaches: each send's gain is the sum of the lane's unmuted
   cables into that output. The Speakers send goes to `connectMain`, an Output device's to
   its device sink, or to `connectMain` while that sink can't play.
2. **Bus effects (PR 5).** Bus FX cannot go through `channelEffects`: its `desiredState`
   throws when no playback channel exists (`apps/radio/src/lib/channel-effects.ts:131-136`),
   and a bus is not a channel. `EffectsController.connectGraph` is soundId-keyed and accepts a
   bus as it stands (`effects-controller.ts:394-457`), so the change is a thin
   `AudioManager.connectBusEffects(busId, in, out)` / `reconcileBusEffects(busId, desired)`
   pair that forwards to the controller with a `DesiredEffectsState` the node engine builds
   itself (tree, dryWet, tempo, `sidechainSoundId: null`). The compatibility sidechain lookup
   only sees AudioManager sounds (`this.sounds.get(id)?.nodes?.filter`,
   `effects-controller.ts:327`), so **a bus can be neither a channelEffects target nor a
   sidechain source** without further code. v2 accepts both limits.

`NodeBusGraph` is a native summing layer, the same kind of thing `BrowserOutputGraph` already
is. It is not the "second engine" the prior-art map warns against, because no effect DSP runs
in it.

### 5.3 Compilation (graph → `EnginePlan`)

1. **Validate** (§5.4). Invalid edges never reach the compiler.
2. **Find lanes.** Each source node starts a lane. Walk downstream while each node has exactly
   one audio input. Map a leading Filter and Pan onto the native strip, and append FX nodes as
   `EffectConfig` entries whose **`id` is the node id**. Stable ids are what let openDAW
   update params in place (`official-opendaw-runtime.ts:459-525`).
3. **Lower series-parallel regions.** At a Split, Stereo Split or Band Split, find the
   immediate post-dominating Merge. If every path between them stays inside the lane, lower
   the region to `fxComposite`/`stereoSplit`/`frequencySplit`, with `chains[]` built from
   branches. Each chain's gain, pan, mute and solo come from the branch cable's params.
   Recurse into nested regions, and reject the region above depth 8 or with more than 4 bands
   (`effect-tree.ts:9-41`). An implicit fan-out (one output port with two cables that later
   rejoin) is treated as a Split, so users need not place one.
4. **Make buses at boundaries.** Any node with fan-in from different lanes (Merge, Crossfade,
   Dial, Return, Speakers), and any fan-out whose branches do not reconverge in-lane, ends the
   lane. A **bus** starts there. A bus is `in` Gain (sum) → optional FX tree (the
   series-parallel region downstream until the next boundary) → `out` Gain. Bus FX use
   `connectBusEffects("node-bus:<id>", in, out)` (§5.2 change 2), so buses get the same
   backend choice, generation tokens and 30 ms router crossfade as sounds, without a
   playback channel.
5. **Plan edges.** Every lane→bus, bus→bus and bus→sink link becomes an `EdgeGain` keyed by
   the React Flow edge id. It carries gain, mute and solo state, and the crossfade or Dial
   weights. A Loop compiles to its guarded DelayNode chain between two buses.
6. **Plan modulations.** Control cables to native AudioParams (edge gain, bus gain, lane pan,
   lane filter frequency, Tape Warp time) become native `OscillatorNode`/`ConstantSourceNode`
   → depth `GainNode` → `AudioParam`. Cables to effect params become a param stream:
   main-thread, 30 Hz, through `channelEffects.change` with the 32 ms throttle the knobs
   already use. Later, if the lane is on the official backend, they become openDAW
   `Modulators.assign` boxes.
7. **Plan sidechains.** `DesiredEffectsState.sidechainSoundId` is never set directly.
   `channel-effects.ts:96-146` derives it from the **first enabled effect in the tree** whose
   `sidechain.channelId` is set, resolved through bindings keyed `${sessionId}:${channelId}`.
   So a key cable writes `effect.sidechain.channelId = "n:<sourceNodeId>"` on the
   Compressor, Gate or Vocoder config. Rules that follow: the key source must be a lane
   channel in the `node` session (never a bus), and only the first enabled sidechain in a
   lane's tree takes effect. The validator refuses a second keyed FX in one lane with "One
   key per lane" rather than letting it silently lose.
8. **Estimate backends.** A lane or bus is `official` only if every effect maps to openDAW,
   `crossOriginIsolated` is true, and the running monitoring-channel count (lanes and FX
   buses, 2 each) stays ≤ 8 (`apps/radio/src/lib/audio/dsp/effects/official-opendaw-mapping.ts:47-61,94-98`).
   Otherwise it is `compat`. The estimate is only displayed; the controller still decides.

The output is `EnginePlan { lanes: Map<nodeId, LanePlan>, buses: Map<nodeId, BusPlan>, edges:
Map<edgeId, EdgePlan>, sinks, modulations, budget }`. Each lane plan carries `soundId =
"node:n:<sourceNodeId>"` (the default `${sessionId}:${channelId}` from
`playback-actions-shared.ts:78-83`) and a `layoutSignature`: a hash of ids, types, order and
chains, with params excluded.

### 5.4 Validation

- **One rule entry.** `connectionVerdict(graph, connection, options)` in
  `lib/node-graph/validate.ts` answers "may this cable connect, and if not, why" as
  `{ ok: true } | { ok: false; code; message }`. The canvas's `isValidConnection`, a drop on
  a node or port, the palette's narrowed list, the Connect… dialog, insert-on-cable and
  heal-on-delete all ask it, and it runs the same `validate()` that load and import run.
- **Port kinds.** Handle ids are `"<dir>:<kind>:<name>"`, e.g. `in:audio:main`,
  `in:sidechain:key`, `in:control:cutoff`, `out:midi:cc`. `<ReactFlow
  connectionMode={ConnectionMode.Strict}>` keeps outputs to inputs; the validator parses
  both ends:
  - audio→audio
  - audio→sidechain, only if the source resolves to a lane in this session
  - control→control
  - midi→midi
  - audio→control is refused with "Audio can't turn a knob", control into a key with "Only
    audio can key this effect".

  Before the kind check come the rules of a node itself: a module can't feed itself
  (`self-loop`), a source takes no audio in (`no-audio-in`), and the sound ends at an output
  (`no-out`). The catalogue test holds these invariants for every definition, and every
  port's `max` is at least 1.
- **Limits.** `max` per port is enforced by the validator ("This input takes one cable",
  "This input is full (8 cables)") and mirrored on each handle: a port counts its cables
  with `useNodeConnections` and sets `isConnectableStart`/`isConnectableEnd`, which React
  Flow 12.12 takes as booleans only. Speakers is unique, an Output device is unique per
  device ("This output already has a module", `deviceOutVerdict`, which the palette and the
  node's device select also ask), and each lane allows at most one Filter, one Pan and one
  keyed FX.
- **Cycles.** Tarjan SCC over audio edges. Every non-trivial SCC must contain at least one
  Loop node; otherwise the connection is refused with "That would feed the sound back into
  itself" (Loop ships later). Web Audio silences delay-free cycles, and the openDAW tree
  cannot represent one. Control cycles are rejected outright. A cable into a full port that
  would also close a loop gets the feedback message, since freeing the port wouldn't help.
- **While dragging.** `onConnectStart` takes one verdict per port in the patch
  (`connectableHandles`, cached in `components/radio/node/connection-hints.ts` until
  `onConnectEnd`): one validation per port facing the drag, none per pointer move. Every
  port reads the drag's origin through `useConnection(selector)` and its own verdict: a
  port the cable may end on grows a foreground ring (`node-port-accept`), every other port
  fades to 0.3 and locks (`node-port-locked`, `isConnectableEnd=false`) with the reason as
  its native title. `isValidConnection` reads the same cache. A refused drop on a node, a
  locked port or a port React Flow snapped to shows one toast with the verdict; a drop on
  empty space opens the palette narrowed to what fits. A drop on a port on the cable's own
  side counts as a drop on its node's body. Tap-then-tap works the same way:
  `onClickConnectStart` takes the verdicts, ports read the first tap from React Flow's
  `connectionClickStartHandle`, and a refused second tap toasts its verdict. Every port
  takes the pointer (React Flow's base CSS gives it only to connectable ones), so a locked
  or full port still shows its title and can be let go or tapped on. Budget refusals are
  patch-wide, so once over budget every port locks with the same message.
- **Rewire.** Either end of a cable drags off its port (`onReconnect`). The drag's
  verdicts are taken on the patch without that cable, so the one-cable input it filled
  takes it back, and a drop commits `reconnectEdge` as one undo step: the old cable goes,
  the new one comes, with the old level, mute and colour. A refused drop toasts its verdict
  as a new cable's would, and a cable end let go on empty space unplugs the cable.
- **Budgets.** Checked at compile time; exceeding a budget is an error on the offending node,
  never a silent drop.

  | Budget | Desktop | Mobile (coarse pointer or iOS) |
  |---|---|---|
  | Concurrently **playing** stream sources | 6 | 4 |
  | Source nodes | 24 | 24 |
  | Buses | 6 | 3 |
  | Buses with FX | 3 | 2 |
  | Loops | 4 | 4 |
  | Tape Warp | 2 × 30 s | 1 × 10 s |
  | Native LFOs | 8 | 8 |
  | Edges | 64 | 64 |

  Playing sources are the ones that cost a decoder, hls.js and a worklet; a live Audio input
  is none of those, so it doesn't count. Play all keeps
  Multiple's at-most-3-concurrent starts (`apps/radio/src/lib/multiple-playback.ts:80,87-113`).

### 5.5 Incremental reconciliation

`diff` compares plans by key and emits minimal ops. `node-playback.ts` applies them in one
microtask batch per store commit:

| Change | Op | Audio behaviour |
|---|---|---|
| Param only (same `layoutSignature`) | `setLaneEffects(tree)` via `channelEffects.change({type:'replace'})` (`apps/radio/src/lib/channel-effects.ts:243`); buses via `reconcileBusEffects` | `EffectsController.reconcile` no-ops identical JSON (`effects-controller.ts:176-248`); openDAW updates in place |
| Lane layout change (add, remove or reorder FX) | `duckLane → replace → await outcome → unduck` | `laneOut` ramps to 0 over 20 ms, the tree swaps (openDAW recreates its groups), then ramps back. About 60-150 ms of dip, and no click. Needs the PR 4 lane connector |
| Native param (pan, filter, edge gain) | `setParam` | `setTargetAtTime(τ = 5 ms)` |
| Edge add | `connect(gain = 0)` then ramp up | 20 ms fade-in |
| Edge remove | ramp to 0, then `disconnect` when a `ConstantSourceNode` ends | The same teardown pattern as `apps/radio/src/lib/audio/manager/effects-backend-router.ts:1-90` |
| Rewire (drag a cable end) | new edge fades in while the old fades out, equal-power | Cable swaps are inaudible |
| Lane add or remove | `createManagedSound` paused / `cleanupManagedChannel` after a 150 ms fade | Same as Multiple (`multiple-playback.ts:434-461`). An Audio input's sound is made only at Go live, and a new device or echo cancellation is a new capture (remove, then add, still live); its channel pair switches live (`setParam channelSelection`) |
| Bus add or remove | build silent, then ramp; the reverse to remove | Bus FX go through the router lane crossfade |
| Undo or template load | a plain diff against the current plan | Same ops, so no rebuild |

Later, lane layout changes will stop dipping. That needs new controller API either way:
`EffectsBackendRouter.switchTo` (`effects-backend-router.ts:67`) is only driven from inside
`EffectsController`, so neither an on-demand crossfade to the bypass lane nor a fourth
`graph` lane that builds the new tree on a twin runtime is reachable today. PR 8 adds one
such method.

### 5.6 Where live data lives

`signal-store.ts` holds per-id level/peak buffers fed by `MeterService.subscribeMeter`
(`meter-service.ts:123`) for lane taps (`getPostFaderNode`, `audio-manager.ts:995`; pre-fader
is `getPreFaderNode`, :984) and bus `out` taps (`setSoundSource`, `meter-service.ts:129`, with
the `meter-service.ts:170-205` fallback at 50 ms).

Components never read it through React state. A node's meter or edge registers a ref by id,
and a single rAF loop writes `style.setProperty('--level', …)` onto the edge path and meter
element, the same way `apps/radio/src/components/radio/dj/shared/peak-meter.tsx:8-195`
animates.

Play state, error and now-playing come from `playbackRuntimeStore`
(`apps/radio/src/lib/stores/playback-runtime-store.ts`) by channel id, as in
`apps/radio/src/lib/hooks/use-multiple-session.ts:22-58`. Nothing high-rate touches
`node.data`, `updateNodeData` or the nodes array.

### 5.7 Failure behaviour per node

| Node | Failure | Behaviour |
|---|---|---|
| Station, File, Platform | play error or CORS silence | InlineError on the node and `PLAY_ERROR` reported with mode `"node"` (`multiple-playback.ts:282-293`). The lane stays connected but silent, and the rest of the patch plays on |
| Station | its session radio is not in this tab (a pick from search, never saved, reopened in a new tab) | The patch stores the whole radio, so init registers it back as a session radio (`registerNodeSessionRadios`). The Station keeps its lane, so a new tab plays what a reload does |
| Audio input | permission prompt, denied, or device gone | "Allow microphone" (a user gesture, `getUserMedia`); "Microphone blocked. Allow it in your browser settings." with no Go live; or "Unplugged: plug it back in or pick another" when `devicechange` drops the device, and the lane pauses. Plugged back in, the device is offered again |
| FX (lane) | worklet unavailable | The existing dry fallback filter→dest (`audio-manager-graph.ts:148-187`), plus a `bypassed` badge |
| FX (lane) | official runtime cap exceeded | The controller falls back to compatibility, and the badge flips to `compat` |
| Bus FX | same | Bus switches to its router bypass lane, and the badge shows |
| Loop | runaway feedback | Feedback is clamped to ≤ 0.95, with a DC-block highpass and soft-clip `WaveShaperNode` inside the loop. If loop RMS stays above -1 dBFS for 2 s, the guard ramps feedback to 0.5 and flashes the node in `--destructive` |
| Output device | no `setSinkId`, `setSinkId` rejects, or device unplugged | The node shows why, and its sends reroute to Speakers (`connectMain`) so nothing goes silent unexpectedly. A device back after hot-plug is tried again |
| CUE | `setSinkId` rejects | Node shows the error, and its input edge is also routed to Speakers |
| Recorder | MediaRecorder error | Stops and offers the partial blob. An unsupported mime type means the node is not offered |
| LFO, param stream | target removed | Modulation edge auto-removed, with an undoable toast |
| Control engine | throws | Bindings freeze at their last value; audio keeps playing |
| Whole graph | activate throws | The lifecycle rolls back to the previous mode (`apps/radio/src/lib/mode-lifecycle-manager.ts:232-268`) |
| Deactivate | a leftover sound | Must be impossible: deactivate fades out and releases every `n:*` channel plus the bus graph before `cleanupOrphanedSounds(..., "node")` (`apps/radio/src/lib/mode-lifecycle-cleanup.ts:11-32`) |

### 5.8 Mobile Safari specifics

- Treat the official openDAW runtime as unavailable. The COEP-credentialless support is an
  unverified assumption, so every FX lane or bus is one AudioWorkletNode, and that is what the
  mobile budget accounts for.
- Output device and Headphones are hidden where setSinkId is missing. A stored Output device
  says so and plays through Speakers.
- Context state `interrupted` shows a Resume button on Speakers.
- Play all uses Multiple's proven path unchanged in the first Node PR.
- Node mode always uses `audio-graph` output. Native output is Single-only
  (`apps/radio/src/lib/channel-state-manager.ts:332-352`).
- Loudness can differ by backend, because the compatibility path adds a ChannelStrip and a
  per-sound limiter (`apps/radio/src/lib/audio/dsp/processor.ts:296-315`). The backend badge
  makes this visible. An optional **per-session backend policy** fixes it at activate:
  all-official when the session has ≤ 4 sounds (lanes plus FX buses) and
  `crossOriginIsolated` is true, otherwise all-compat. It needs one new `EffectsController`
  entry point, so it ships optional in PR 5 (§12 question 4).

## 6. Visual design

### Colour

Five named values, all borrowed from existing semantics. No new brand hue and no new theme
token beyond these aliases. They are defined once as CSS variables in a new
`apps/radio/src/styles/node-mode.css`, following the `:root`/`.dark` pattern of
`packages/ui/src/styles/globals.css`.

Signal type is carried by **dash pattern first and colour second**. Idle audio uses the
muted-foreground Wire, and emerald appears only on live cables.

| Name | Token | Dark | Light | Cable pattern | Used for |
|---|---|---|---|---|---|
| Wire | `--node-wire` → `var(--muted-foreground)` | `#9f9fa9` | `#54545c` | audio: solid, 2 px stereo / 1.25 px mono. MIDI: dash-dot, square end marker | idle audio and MIDI cables, ports |
| Mod | `--node-mod` (EQ highBell blue) | `#3b82f6` | `#2563eb` | dotted 1.5 px, round caps | control cables |
| Key | `--node-key` (meter amber) | `#fbbf24` | `#b45309` | long dash 6/4 | sidechain cables and port ring |
| Live | `--node-live` (meter emerald) | `#34d399` | `#047857` | solid, stroke +0.5 px, opacity follows `--level` | audio cable while signal is present, playing node dot |
| Clip | `--node-clip` → `var(--destructive)` | `#ff6467` | `#d40c18` | 150 ms flash | clipping, errors, Loop guard trip |

Light Live is darkened from the meter's `#34d399` for contrast on `#fbfcfd`. Blue, amber and
neutral stay separable for deuteranopia and protanopia, and every kind differs by dash
pattern, so hue is never the only cue; Live also thickens the stroke. The "on" state keeps
the canon `border-primary/20 bg-primary/5`. Session stations keep `border-l-[#00d084]/40`.
Chart tokens stay unused. React Flow's `--xy-*` variables map to `--background`, `--border`
and `--ring`, with `--xy-edge-stroke-default` → `--node-wire`.

### Type

Reuse the app's families as they actually render. Node chrome is `font-sans`: titles
`text-xs font-medium`, subtitles `text-xs text-muted-foreground`, port labels `text-[10px]`
sentence case, values `text-[10px] tabular-nums`. Near faders and knobs, hints use native
`title=`, not Tooltip.

**Node chrome carries no mono caps.** They stay in the header wordmark and the ModeSelect
"NODE" label only. Node titles, palette, inspector, badges and ports are all sans; the
`compat`/`bypassed` badges are lowercase sans `text-[10px]`.

One case needs the owner's call, not an assertion of canon. The shared Knob renders its
caption as `font-mono text-[9px] uppercase tracking-wider`
(`packages/ui/src/components/knob.tsx:207-209`), so reusing `EffectParams` in node bodies and
the inspector would put mono caps outside the wordmark, the mode toggle and DJ hardware
labels. The options are in §12 question 7; the wireframes below show sentence-case captions
as the target.

### Layout

**Desktop canvas** (≥ 768 px). The canvas and inspector are a `ResizablePanelGroup`. A
collapsible Stage strip sits under the canvas once macros exist (PR 6):

```
┌ header 48px ─ logo radio │ [Single][Node][DJ] │ ⚙ ─────────────────────────┐
├──────────────────────────────────────────────────────────┬────────────────┤
│ [search stations…      ] [+ Add /] [Templates ▾]  ⟲ ⟳   │ Inspector      │
│                                                          │ Compressor     │
│  ┌Station──────────┐                                     │ ───────────    │
│  │▶ KEXP        ⋯ │══════╗                               │ (EffectParams  │
│  │ Khruangbin – …  │      ║   ┌Compressor──┐             │  full layout,  │
│  │ ▁▁▁▁▁▁▁● vol    │      ╚══▶│◉ Thr  ◉ Rat│═══╗         │  compressor-   │
│  └─────────────────┘   ┄┄┄┄┄┄▶│key         │   ║         │  curve canvas) │
│  ┌Station──────────┐   ┆      └────────────┘   ║  ┌Speakers──────┐       │
│  │▶ BBC 4 (talk)   │┄┄┄┘ (amber long-dash)     ╚═▶│ ▶ Play all (2)│       │
│  └─────────────────┘                              │ ▁▁▁▁● ▮▮ meter│       │
│                                                   └───────────────┘       │
│  Drag a cable to empty space to add a node                                │
├──────────────────────────────────────────────────────────┴────────────────┤
│ Stage ▾  [Macro ◔] [Dial ◔] [Crossfade ━●━]    ☐ show cables             │
└───────────────────────────────────────────────────────────────────────────┘
```

"Show cables" draws faint Wire-coloured lines from each pinned Stage control up to the node it
drives, so the performance surface never hides the routing (the Max Presentation complaint).

**Node anatomy.** The node is an `EffectItem` restyled as a node: `rounded-md
border-border/50 bg-card`, no shadow. Widths are fixed: station 240 px, FX 64 px per knob
column + gap-x-2 (max 4 columns), output 200 px.

**Where a new node lands.** A Station, Track, File or Audio input from the palette stacks
below the lowest node in the source column, by row: 160 px for a filled source, 240 px for
an empty File (or one whose file is gone after a reload), 320 px for an empty Track, 280 px
for an Audio input (about 260 px once wired and live). An FX, Gain or Merge goes between the sources and Speakers
(`Speakers.x - 180`), below everything, so a cable wired Input → FX → Speakers runs forward;
an output goes right of everything. A reveal after an add waits for the new node's measured
size and keeps it clear of the canvas hint. On a phone, an empty Station, Track or File added
from the Stage or Rack opens the Patch on it, as neither lists an empty slot. Selecting an
empty slot keeps the Rack: it has no strip to inspect until it holds something.

```
        ┌──────────────────────────────────────┐
 in ○───┤ [icon] Compressor   compat   ⏻   ⋯  │  header h-7: icon tile size-6,
 audio  ├──────────────────────────────────────┤  title text-xs, Switch, menu
 key ◌──┤   ◉        ◉        ◉        ◉       │  body bg-muted/30 border-t:
 (amber)│  Thr      Ratio    Attack   Mix      │  first EFFECT_LAYOUTS row only;
        │  -18 dB   4:1      10 ms    100%     ├───○ out audio
        └──────────────────────────────────────┘  caption style pending §12 q7
 ports: 10px dots on the edge, 20px hit target (coarse: 28px),
 label on hover/focus; the "on" state = border-primary/20 bg-primary/5
```

**Phone** (< 768 px). Tabs choose between Stage, Rack and Patch, following the DJ mobile
pattern of tabs plus stacking plus accordion:

```
┌ header ───────────────────────┐
│ [ Stage | Rack | Patch ]      │
├───────────────────────────────┤
│ Stage (default)               │   performance surface:
│ ▶ Play all (3)  master ━━●━   │   master, pinned macros as big
│ ◔ Dial   ◔ Macro 1            │   knobs (PR 6), every source with
│ ▸ KEXP   ▶  ━━●━━   ▂▃        │   play and volume
│ ▸ NTS 1  ▶  ━━━●━   ▂▅        │
├───────────────────────────────┤
│ Rack                          │   the compiled EnginePlan, listed
│ ▸ Bus: Dial (3 in)            │   by bus → lanes; each lane shows
│   ┌ StationRow  ▶  vol ─────┐ │   its FX as chips that open the
│   │ [Comp] [Delay] [+]      │ │   inspector in a bottom Drawer
│   └─────────────────────────┘ │
│ ▸ Direct to Speakers          │
└───────────────────────────────┘
 Patch tab = canvas, pinch zoom, tap-port-then-tap-port to connect,
 add-node palette and inspector as vaul bottom Drawers.
```

### Review against defaults

The generic node-editor defaults are:

- a dotted grid background;
- rainbow category headers (purple FX, green sources);
- a minimap in the corner;
- drop-shadowed floating nodes;
- animated dashed "marching ants" edges on everything;
- a Controls widget stack.

The generic AI-design defaults are gradients, glass panels and big rounded cards with emoji.

What this design does instead:

- No grid, or at most an optional `border/30` 24 px dot at zoom ≥ 1.
- Category comes from the lucide icon tile and the port shape, not header colour.
- No minimap in v1; fit-view is on `F`, and on a phone on tapping the open Patch tab again.
  A phone fit stops at zoom 0.6, where text reads and ports take a tap, and the patch pans
  instead of shrinking past it; a patch still too tall opens on its top (Speakers and the
  first sources), not its middle.
- Nodes are flat `bg-card` with the app's `border-border/50`.
- Motion exists only where signal exists (Live), and reduced motion is honoured through the
  global clamp.
- Cables are achromatic by default, because audio is the majority. Colour is reserved for the
  minority kinds and for live signal, so a patch reads like the rest of the zinc app, not
  like a flowchart tool.
- React Flow's attribution badge is hidden (`proOptions={{ hideAttribution: true }}` from a
  module constant), so the canvas corner stays clear.

## 7. Interaction

- **Adding nodes.** Press `/`, double-click the canvas, click "+ Add", or drop a cable on
  empty space (`onConnectEnd`). All four open the palette, which extends the existing
  EffectPicker (a Dialog with SearchField and Enter-picks-first) with Sources, Routing,
  Control, Outputs and Templates sections. A cable drop filters the palette to kinds
  compatible with the dragged port and auto-wires the new node. The search bar above the
  canvas adds a Station node wired to Speakers and starts it playing, as Multiple did
  (`apps/radio/src/components/radio/multiple/index.tsx:92-102`). An empty Station slot is
  the same search inline. `Tab` is deliberately **not** hijacked, so focus traversal stays
  intact.
- **Connecting.**
  - Drag port to port, or tap-then-tap (`connectOnClick`), with `connectionRadius` 24.
  - Valid targets highlight during a drag.
  - Dropping onto a node with exactly one compatible input auto-connects.
  - Dropping a node onto a cable inserts it; deleting a node heals the path when kinds allow.
  - Selecting an FX node offers "Swap effect…", which keeps all cables and any modulation
    whose param key still exists.
- **Series ⇄ parallel.** Select two FX nodes in series and press `P`: they become Split →
  both → Merge. `S` does the reverse. The compiler's lane or bus badge on Merge makes the
  consequence visible.
- **Live rewiring without clicks.** Every edit becomes reconcile ops (§5.5). Cable changes are
  gain-ramped or equal-power crossfaded, FX layout edits duck their lane for about 100 ms, and
  knob drags go through `useThrottledParam` (32 ms).
- **Keyboard and screen readers.**
  - React Flow's built-ins cover Tab to nodes and edges, arrow-key moves and Backspace
    delete. Knobs inside nodes carry `nodrag nowheel nopan`, and their keydown is stopped so
    arrows adjust the knob rather than move the node.
  - Keyboard connecting, which React Flow 12 lacks (issue #5620): `C` on a focused node opens
    a "Connect…" dialog with two comboboxes (this node's port, then a target port), filtered
    by the same `connectionVerdict`.
  - `I` inserts into the selected cable, `B` bypasses, and `Cmd+D` duplicates.
  - `ariaLabelConfig` sets `aria-roledescription="audio module"`, and edges get labels like
    "KEXP audio to Compressor input".
  - The Rack view is the complete non-visual path. It is the same compiled plan as a list,
    and every node param in it is reachable.
  - Space plays or pauses all, as in Multiple (`multiple/index.tsx:115-142`).
    `panActivationKeyCode` is set to `null` so Space is not stolen for panning.
- **Undo.** A snapshot stack of the graph document (100 steps) kept in the TanStack node
  store. Snapshots are taken on drag stop, connect, delete, template load and knob release
  (`Cmd+Z` / `Shift+Cmd+Z`). Undo is just another diff, so it is click-free too. This is our
  own code: no zundo, and nothing copied from React Flow Pro.
- **Templates.** The Templates menu and the palette list Starter, All my stations, Duck and
  Blank, in that order. Each replaces the patch as one undo step.
  - **Starter**: one empty Station slot wired to Speakers, in Duck's columns. It is the
    default for a new node session. Play all does nothing until the slot holds a station.
  - **All my stations** (id `start-from-multiple`): every enabled saved station plus session
    stations, in Multiple's order (saved first; `multiple-playback.ts:120-197`), each wired
    to Speakers at its volume.
  - **Duck** (PR 4): a talk station keys a Compressor on a music station.
  - **Frankenstation** and **Two cities** (PR 5): three stations in bands → Merge; two
    stations panned hard L/R.
  - **Dial** and **Radio Dérive** (PR 6): the first 3 enabled stations → Dial → Speakers;
    Clock → Randomiser → Station roulette through Static.
  - **Talk-over** (PR 7): station + Mic → compressor sidechain.
  - **Blank**: Speakers only.
- **MIDI.**
  - `EffectParams` gains a `midiTargetPrefix` prop. Its props today
    (`apps/radio/src/components/audio/effect-params/effect-params.tsx:12-17`) take only
    `deckId`/`effectId`, while `declarative-params.tsx` and `container-params.tsx` already
    accept a prefix. Passing `node:<nodeId>` through is the concrete route to MIDI learn.
  - Any node control wrapped in MidiControlWrapper gets Learn, Transform and Clear with the
    target `node:<nodeId>:<paramKey>`. Container children use `node:<nodeId>:chain:<chainId>:…`.
  - MidiAction groups are named after the node title, so they list in MIDI settings.
    `apps/radio/src/components/settings/midi-settings.tsx:197,287` keeps branching on
    `!== "dj"`.
  - **MIDI in** (PR 6) makes those mappings visible: its CC cables are the mappings, and
    deleting a cable clears one. **Macro** cables carry a `MidiTransform` and reuse
    `applyTransform` and the existing transform editor, so there is no new curve UI.
- **Phone.** Stage is the default tab; Rack is the full accessible path. Patch uses 20-28 px
  handles, pinch zoom and tap-tap connect. The inspector and palette open as bottom Drawers.
  Budgets drop to 4 playing streams, with a clear message on the fifth play.

## 8. Persistence and migration

### Schema v2 (`apps/radio/src/lib/node-graph/schema.ts`)

```ts
nodeGraphSchema = z.object({
  version: z.literal(2),                 // v2: every source's data has a `strip`
  nodes: z.array(z.object({
    id: z.string(),                      // stable; also EffectConfig id and lane key
    type: z.enum(NODE_TYPES),
    position: z.object({ x: z.number(), y: z.number() }),
    data: nodeDataSchema,                // discriminated by type: radio snapshot or
                                         // empty slot, volume, muted, effect config…
    pinned: z.boolean().optional(),      // shown on Stage
  })),
  edges: z.array(z.object({
    id: z.string(), source: z.string(), sourceHandle: z.string(),
    target: z.string(), targetHandle: z.string(),
    gain: z.number().default(1), muted: z.boolean().default(false),
    depth: z.number().optional(),        // control cables
    transform: midiTransformSchema.partial().optional(), // Macro and MIDI cables
    color: z.string().optional(),        // user override
  })),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});
```

`migrateNodeGraph(raw)` upgrades by `version`. An unknown future version is shown read-only
and never overwritten. v1 → v2 adds a default strip to every source: `{ trimDb: 0, pan: 0,
solo: false }`, plus `{ speed: 1, keyLock: true, loop: false, cue: null, cueListen: false }`
on a Track or File and `{ monitor: false }` on an Audio input. Because the session record
pins the graph version, the stored node session is upgraded first in
`initializePlaybackSessions`, before anything updates the collection
(`collections/migrations/node-graph-v2.ts`), as the Multiple migration is. A v1 build in
another tab reads a v2 patch as newer, so read-only.

### Where it lives

- The playback session record `id: "node"` in `playbackSessionsCollection` (localStorage
  `radio-app-playback-sessions`, `apps/radio/src/lib/collections/playback-sessions.ts:35`)
  gains `graph: nodeGraphSchema.optional()`.
- `session.channels` stays, as a **derived cache** written by the compiler in the same
  update: one channel per lane, `id: "n:<nodeId>"`, `role: "node"`, carrying radio, volume,
  muted, pan, filter, from the strip speed, repeat (loop) and cue listen, and `effects` (the lowered tree, including any `sidechain.channelId`).
  That keeps `restoreManagedChannels`, `setManagedChannelPlaying`, NAM externalisation and
  `channelEffects` (keyed `node:n:<id>`, `apps/radio/src/lib/channel-effects.ts:92-93`)
  working unchanged.
- `masterVolume` stays the Speakers gain.
- Positions persist on drag stop, and everything else on commit.
- Named user patches (v2) go in a new `apps/radio/src/lib/collections/node-patches.ts`
  collection (localStorage `radio-app-node-patches`, `{id, name, graph, createdAt,
  updatedAt}`).

### Export and import

- `apps/radio/src/lib/db/export-import.ts` adds `nodePatches` and the node session graph to
  backups. Imports run Zod parsing plus `migrateNodeGraph` and `validate()`, and fail closed.
- Share-by-URL (v2) is `#patch=` + lz-string of the graph. It strips file blobs and device
  ids, and marks session radios as discovered stations. Whether it also strips non-catalogue
  stream URLs, which can carry tokens, is §12 question 11.

### Exact migration (`apps/radio/src/lib/collections/migrations/multiple-to-node.ts`)

Old records load unvalidated, while any update of a stale record throws. So the migration
runs **before** any mutation of either collection. It is idempotent.

1. **Settings.** In `initializeSettings` (`apps/radio/src/lib/collections/settings.ts:61-75`),
   right after `stateWhenReady()`: if `player.mode === "multiple"`, call
   `settingsCollection.update(SETTINGS_ID, d => { d.player.mode = "node" })`. The merged
   object is valid, so it passes. This runs inside `initializeCriticalCollections`, so
   `preloadRadioMode` in `apps/radio/src/lib/root/root-bootstrap.ts:10` already sees
   `"node"`.
2. **Session.** In `initializePlaybackSessions` (`playback-sessions.ts:764`), as the **first**
   step after the `stateWhenReady` awaits and **before the `shouldRestore` branch**. The
   branch matters: `externalizeStoredNamModels` is called at :778 only when `shouldRestore`,
   so the migration must also run when it is skipped. If the store has an `id: "multiple"`
   record and no `"node"` record:
   - Copy the raw record and the old mode once to localStorage `radio-app-multiple-backup`,
     for manual recovery and for the reverse migration (§10).
   - Keep channels whose radio is saved, or is a session radio still in `sessionStorage`
     (the same test as `pruneStaleMultipleSessionChannels`, `playback-sessions.ts:606-626`).
   - Sort by `order`, and create one **Station** node per channel with `{radio, volume,
     muted}`. Positions go in a single column (`x: 0, y: order * 112`), or two columns if
     there are more than 8. The node id is `src-<radio.id ?? slug(radio.name)>`, so the
     saved-under-new-id carry-over from `synchronizeStations` still applies.
   - Create **Speakers** at `x: 480`, vertically centred, with gain `= masterVolume`, plus
     one edge per station.
   - Compile, then `insert` the `"node"` session with the graph, derived channels,
     `masterVolume` and the defaults for `activeChannelId`, `crossfadePosition`,
     `headphoneVolume` and `tempo`. The insert validates.
   - `playbackSessionsCollection.delete("multiple")`. Delete does not validate.

   If a `"node"` record already exists, the step only deletes the stale `"multiple"` record.
3. **Fresh stores, `restoreStateOnLoad === false`, or a missing `"node"` record.** Build
   `"node"` from the Starter template (`buildDefaultNodeSession`): one empty Station slot
   wired to Speakers. A stored or migrated `"node"` session keeps its graph; with
   `restoreStateOnLoad === false` the Starter is rebuilt on every load. This replaces
   `buildMultipleSessionFromEnabledRadios` at its three call sites (`playback-sessions.ts:783`,
   `:788` and `:795`). Whether `restoreStateOnLoad === false` should also discard an authored
   graph is §12 question 12.
4. **Unknown modes at runtime.** A `normalizePlayerMode(mode)` helper maps `"multiple" →
   "node"` and anything unknown to `"single"`. It is used by `preloadRadioMode`, by the
   `Radios` renderer (`apps/radio/src/components/radio/index.tsx:35-63`, which today renders
   Single without a sync), and by `mergeImportedData`/`normalizeImportedSettings`
   (`apps/radio/src/lib/db/export-import.ts:17-30,332,435`). Backup payloads containing a
   `"multiple"` session are converted by the same function as step 2.
5. **Cross-tab.** An old tab can write `mode: "multiple"` or a `"multiple"` session back
   through storage events. A collection-change listener on `playbackSessionsCollection`
   re-runs the idempotent step 2 whenever a `"multiple"` record appears, which just deletes
   it when `"node"` exists. A settings listener runs `normalizePlayerMode` and then
   `modeLifecycleRequests.requestMode("node")`, which commits a valid value. The old tab
   keeps fighting until it reloads (§12 question 10).
6. `resetAllSettings` (`apps/radio/src/lib/settings.ts:35`, which loops
   `["single", "multiple", "dj"]` today) deletes `single`, `node`, `dj` and, defensively,
   `"multiple"`.

## 9. Removal plan

| Touch point | Action / replacement |
|---|---|
| `apps/radio/src/components/radio/multiple/index.tsx` (17-219) | Delete. Replaced by `components/radio/node/index.tsx` (canvas + Stage + Rack + Speakers bar, ClientOnly + `React.lazy`). Space and search-add behaviours move there |
| `apps/radio/src/components/radio/multiple/multiple-global-controls.tsx` | Delete. Play all (N), master VolumeControl and mute move into `node/speakers-node.tsx` and the Stage tab |
| `apps/radio/src/components/radio/multiple/multiple-radio-card.tsx` | Delete. The body is repurposed as `node/station-node.tsx` (RadioNowPlaying with viewport-gated polling, RadioItemActions, InlineError, PlayPauseButton, VolumeControl, session stripe; SearchField when empty) |
| `apps/radio/src/components/radio/multiple/use-multiple-radio-management.ts` | Delete. Edit, delete, save-discovered and hide-restore move to `node/use-node-radio-management.ts`. Hiding a saved station **disables its Station node** (greyed, lane released) instead of removing it, because membership is now user-curated |
| `apps/radio/src/components/radio/multiple/use-multiple-radio-management.test.tsx` | Delete; new tests for the node management hook |
| `apps/radio/src/lib/multiple-playback.ts` | Delete. Start ownership, revisions, cancellation, playAll ≤ 3, fade-out deactivate, orphan check, mute memory and carried-channel logic move into `lib/node-playback.ts` |
| `apps/radio/src/lib/multiple-playback.test.ts` | Delete; ported cases in `node-playback.test.ts` |
| `apps/radio/src/lib/hooks/use-multiple-session.ts` (+ test at :72) | Delete; `use-node-session.ts` (live query on `id == "node"`) |
| `apps/radio/src/lib/mode-lifecycle-manager.ts:13,150-162` | `node: createLifecycle(node.activate, node.deactivate)` |
| `apps/radio/src/lib/mode-lifecycle-manager.test.ts:150,609,665` | Retarget to `node` and `n:station-1` |
| `apps/radio/src/lib/mode-lifecycle-requests.test.ts:94,120` | `"multiple"` → `"node"` |
| `apps/radio/src/components/radio/radio-mode-loader.ts:10-12,26-35,51` | `loadNodeRadios` (imports `./node`, runs `initializePlaybackSessions`); preload map entry `node`; accepts legacy input via `normalizePlayerMode` |
| `apps/radio/src/components/radio/index.tsx:9,15,18,27,35-63` | `RADIO_MODES` gets `node`, a lazy `NodeRadios` and renderer entry `node`; the legacy-mode normalise + requestMode path (§8 step 4) |
| `apps/radio/src/components/radio/radio-loading-skeleton.tsx:80-110,167` | `NodeRadioLoadingSkeleton` (3 node blocks + Speakers) and a `mode === "node"` branch |
| `apps/radio/src/components/settings/mode-select.tsx:14-18,36,55` | Icon map `node: Cable` (lucide); the label comes from `playerModes` |
| `apps/radio/src/components/theme/header.tsx:12-14,38` | No change (lazy ModeSelect); verify the h-7 item fits in `max-w-xs` |
| `apps/radio/src/lib/types.ts:10,21-25` | `{ label: "Node", value: "node" }` replaces Multiple, keeping the order Single, Node, DJ |
| `apps/radio/src/lib/collections/settings.ts:9,120` | `playerModeSchema` and the `updatePlayerSettings` union: `"multiple"` → `"node"`. Migration lives in `initializeSettings` (:61-75) |
| `apps/radio/src/lib/settings.ts:35-37` | Delete `node` (and a defensive `multiple`) |
| `apps/radio/src/lib/collections/playback-sessions.ts:38-39,281` | `PLAYBACK_SESSION_IDS = ["single","node","dj"]` |
| `playback-sessions.ts:249-255` | Channel role `"multiple"` → `"node"` |
| `playback-sessions.ts:257-292` | Session schema adds `graph` (optional) |
| `playback-sessions.ts:558-593` (`buildMultipleSessionFromRadios`, `buildMultipleSessionFromEnabledRadios` at :587) | Replaced by `buildNodeSessionFromTemplate("start-from-multiple", radios)` |
| `playback-sessions.ts:606-626` (`pruneStaleMultipleSessionChannels`) | Replaced by `restoreNodeSessionRadios`, which registers a Station's session radio back in a new tab rather than dropping its lane |
| `playback-sessions.ts:764-811` (`initializePlaybackSessions`) | Migration first, before the `shouldRestore` branch, then the node build at the three sites (:783, :788, :795) |
| `playback-sessions.ts:926-930` (`getMultipleChannelId`) | Replaced by `getNodeChannelId(nodeId) = "n:" + nodeId` |
| `apps/radio/src/lib/collections/index.ts:10` | Re-export `getNodeChannelId` |
| `apps/radio/src/lib/collections/playback-sessions.test.ts:10,417-761` | Port build and prune tests to node; add migration tests (multiple→node, stale session radio, masterVolume, order, `restoreStateOnLoad === false`) |
| `apps/radio/src/lib/managed-playback-internals.ts:29-34` | `PLAYBACK_MODE_LABELS` gets `node: "Node"`. `ManagedPlaybackSessionId` automatically includes `node` (wanted) |
| `apps/radio/src/lib/playback-action-errors.ts:4` | `PlaybackActionMode` `"multiple"` → `"node"` |
| `apps/radio/src/lib/external-url/utils.ts:224-250` | Signature becomes `mode: PlaybackSessionId`; policy unchanged in v1 (platforms blocked outside DJ) |
| `apps/radio/src/lib/hooks/use-media-session.ts:51,63-66,115-116,127-128` | `{ mode: "node"; radios; playingCount }`, title "Node patch" |
| `apps/radio/src/lib/feedback/endpoint.ts:25-29,71-74` | `node → "Node"`; unknown values including `"multiple"` map to "Unknown" (the value is untrusted) |
| `apps/radio/src/components/feedback/app-feedback.tsx:274-283` | No change (sends `usePlayerMode()`) |
| `apps/radio/src/lib/hooks/use-settings.ts:35-37`, `apps/radio/src/components/settings/midi-settings.tsx:197,287` | No change (`!== "dj"`); node MIDI targets are listed through MidiAction groups |
| `apps/radio/src/lib/root/root-bootstrap.ts:10` | Receives the migrated mode; `preloadRadioMode` normalises anyway |
| `apps/radio/src/lib/channel-state-manager.ts:393-397` | No change (iterates the ids) |
| `apps/radio/src/lib/channel-effects.ts:92-93`, `apps/radio/src/lib/playback-actions-shared.ts:78-83` | No change; keys become `node:n:<id>` |
| `apps/radio/src/components/audio/effect-params/effect-params.tsx:12-17` | Add `midiTargetPrefix` and pass it to the inner renderers |
| `apps/radio/src/lib/db/export-import.ts:17-30,332,435` | `normalizePlayerMode` on import; convert `"multiple"` sessions; add node patches |
| `apps/radio/src/lib/db/export-import.test.ts:176,195` | Expect `"multiple"` in, `"node"` out |
| `apps/radio/src/components/radio/radio-now-playing.test.tsx:78,85,654` | Import `StationNode` body instead of `MultipleRadioCard` |
| `apps/radio/src/lib/use-mode-transition-snapshot.ts:11-33` | No change (mode-agnostic) |
| `apps/radio/src/lib/mode-lifecycle-cleanup.ts:11-32` | No change; label `"node"` |
| `apps/radio/package.json:53` | Leave `zustand` alone in this work; it is unused by `src`, and removing it is a separate cleanup |
| `apps/radio/README.md:8,37` | Document Node mode |
| `apps/radio/TANSTACK_DB_LOADING_RESEARCH.md:21,77,95` | Annotate that the Multiple timings are historical and name the node chunk |

## 10. Delivery (stacked PRs)

Every PR runs `bun run check`, `bun run typecheck`, `bun run --filter @avoid.quest/radio test`,
and `bun run --filter @avoid.quest/radio build` (the build matters for chunk and SSR
isolation).

1. **`node-graph` core (pure).** Schema, catalogue (v1 subset), validate, compile, reconcile.
   Heavy unit tests: series-parallel lowering to `fxComposite`/`stereoSplit`/`frequencySplit`,
   depth 8, band limits, Tarjan SCC with the Loop rule, port kinds, one key per lane,
   budgets, and that a param-only diff yields only `setLaneEffects`. No UI and no runtime
   wiring, so it is safe to ship.
2. **Node mode at Multiple parity.**
   - Add `@xyflow/react` (12.x) to apps/radio, and `@import "@xyflow/react/dist/base.css"
     layer(base)` in a radio stylesheet.
   - Add the `"node"` id, the `graph` field, the `"node"` channel role, the migration,
     `normalizePlayerMode`, the backup key, and the cross-tab collection and settings
     listeners.
   - Add `node-store.ts` (TanStack Store), `node-playback.ts` (lanes go straight to
     `connectMain`, so no engine change yet), `use-node-session`, and the canvas with Station
     (including its empty search state) and Speakers, plus the Stage (sources and master) and
     Rack tabs.
   - Add the "Start from Multiple" template, undo, the Connect… dialog, media session and
     skeleton.
   - ModeSelect shows Node instead of Multiple.
   - **Tests:** a migration test that seeds raw localStorage with a `multiple` record and
     `mode: "multiple"`, runs init, then performs a later update and asserts no
     `SchemaValidationError`; the same with `restoreStateOnLoad: false`. A build check that
     `@xyflow` is absent from the Worker/SSR bundle.
   - **Rollback is not a code revert.** The migration rewrites the stored mode to `"node"`
     and deletes the `"multiple"` record, so pre-PR-2 code would load a mode its Zod enum
     rejects on the next update. PR 2 therefore also ships a tested reverse migration,
     `node-to-multiple.ts`, that rebuilds a `"multiple"` record from Station lanes (or from
     `radio-app-multiple-backup`) and rewrites the mode. A rollback is a forward PR that
     wires it into init. The Multiple files stay in the tree until PR 3 only to keep this PR
     reviewable, not as a rollback lever.
   - **Manual WebKit check on an iPhone is required before merge:** Play all with 4 streams,
     and switching between modes.
3. **Delete Multiple.** Remove every row in §9, remove `"multiple"` from the enums, keep the
   migration, and update tests and docs.
4. **In-lane FX.**
   - `setSoundOutputConnector` in AudioManager and the per-lane `laneOut` gain, with a test
     that DJ and Single are unaffected. The duck-swap in §5.5 needs it.
   - 21 effect nodes (all but Werkstatt) plus native Filter, Pan and Gain. Split, Stereo
     Split, Band Split and in-lane Merge.
   - Inspector via EffectParams with the new `midiTargetPrefix`; node bodies via the first
     EFFECT_LAYOUTS row; duck-swap for layout changes; backend badges.
   - Key cables that write `effect.sidechain.channelId` (Duck template), and MIDI learn with
     the `node:` prefix.
5. **Bus layer and routing.**
   - `connectBusEffects`/`reconcileBusEffects` (§5.2 change 2).
   - `node-bus-graph.ts` and cross-lane Merge.
   - Crossfade, Send and Return, Mute and Solo, Loop with its guard, Tape Warp.
   - Scope node, signal-store with breathing cables, and the Frankenstation and Two cities
     templates.
   - Optional per-session backend policy (§5.8).
6. **Control.** Macro (MidiTransform cables), LFO (native AudioParam plus a 30 Hz param
   stream), Clock, Randomiser, Follower, Sundial, MIDI in as a mapping projection, Static, and
   the Dial (Dial template becomes the new-user default). Station song-change and title-hash
   outputs with the Title trigger. Station roulette and Radio Dérive through Static. Weather
   front. Stage pinned macros and the desktop Stage strip with its cable overlay.
7. **More sources and outputs.** Audio input and Output device shipped early, in the
   io-nodes layer (see §3), and Track and File in the platform-sources layer. Still here:
   the Talk-over template, Recorder, Headphones
   (CUE), node-patches collection,
   export/import, and share URL.
8. **Later.**
   - A new `EffectsController` method for dip-free structural swaps: a `graph` lane in
     EffectsBackendRouter, or at least an on-demand bypass crossfade (§5.5).
   - openDAW Modulators for effect-param LFOs on the official backend.
   - Werkstatt code node.
   - Migration to React Flow 13 behind `components/radio/node/flow-adapter.ts`.

## 11. Prior art

| Project | Lends | Left behind | openDAW reuse |
|---|---|---|---|
| openDAW (npm packages, LGPL) | FX Composite, Stereo Split and Frequency Split cells as the lowering target for in-lane parallelism; sidechain binding | App-repo UI code (AGPL); AudioBusBox/AuxSendBox for buses, because the project's master output is disconnected (`official-opendaw-runtime.ts:~246`), monitoring is capped at 8 channels, and Safari likely cannot run it; ModularDevice ("inaudible yet", `EffectFactories.js:356`) | **Reused**: composites, sidechain, all effect devices through the existing adapter. **Later**: `Modulators.assign` for effect-param LFOs and MIDIControllerBox. **Not reused**: buses and sends (native GainNodes instead) |
| React Flow Web Audio tutorial | A store mirroring the engine with shared ids | Direct connect/disconnect per UI action; replaced by compile → diff → ramped ops | n/a |
| Elementary Audio | Reconcile by stable keys; node ids are effect ids and lane keys | Its own renderer and mono graph model | n/a |
| Bitwig Grid | Drop onto a cable to insert, delete heals, swap in place keeps cables, pre-wired defaults | Per-port scope inspector (replaced by cable glow and the Scope node) | n/a |
| Cables.gl | Palette on cable drop, auto-connect when one port fits, tap-tap for touch, an Output op with play permission (becomes Speakers' play and Resume) | Subpatch ops in v1 | n/a |
| TouchDesigner | Pattern and colour by signal family, typeahead create | Tab as the palette key (breaks focus order); strict no-cross-family rule (Follower bridges it) | n/a |
| Bespoke Synth | Signal shown on the cable, target highlighting, level→control bridge | Full oscilloscope cables (too costly at 6 streams on mobile); an empty start | n/a |
| Pure Data | Keyboard surgery: insert, bypass, swap, all undoable | Fan-out ordering ambiguity (audio sums are order-free; control fan-out is evaluated in edge order and shown) | n/a |
| VCV Rack | Thicker stereo cables, per-cable colour override | Clock and reset spaghetti (Clock fan-out is drawn as one cable plus a count) | n/a |
| Max/MSP and Mira | A separate performance surface: Stage on phones and as a desktop strip | Presentation modes that hide cords entirely (Stage can overlay them) | n/a |
| Reaktor Blocks | Anti-pattern: swapping must keep modulation, and ports must not all be audio-rate | Everything else | n/a |
| Patchcab and BlokDust | Named templates, global play plus master, share by URL | Tiny knobs (coarse-pointer sizing is used instead) | n/a |
| NoiseCraft, Kabelsalat, Strudel, Hydra, Cardinal | Warnings: test WebKit early, no main-thread work on audio paths during resize, active-path highlighting; single-sample feedback shows loops are musical (the Loop node) | All code (GPL/AGPL); whole-graph single-worklet compilation | n/a |
| WAM 2.0 | Composite-node idea for a future group node | Third-party plugin loading | n/a |

## 12. Risks and open questions for the owner

1. **React Flow bundles zustand 4.** The app does not use zustand in `src` and keeps node
   state in TanStack Store, so the #5685 mixed-major crash cannot come from app code. React
   Flow is fed only as controlled props and lives in a lazy client-only chunk (about 60 kB
   gzip). **Accept the chunk size?**
2. **React Flow 13 churn.** colorMode, `useStore` and CSS layers will change. Everything goes
   through `flow-adapter.ts`. **Attribution badge**: is it acceptable to keep it visible
   without buying Pro?
3. **Mobile Safari is unverified.** The claims that crossOriginIsolated is false, that 4
   concurrent streams is a safe budget, and that play-all outside the first gesture works for
   more than 3 elements must be measured on a device in PR 2. The budgets are guesses until
   then.
4. **Loudness.** Summing 6 streams at unity can clip, and the two backends differ in level
   (`processor.ts:296-315`). The proposed answer is the optional per-session backend policy
   (§5.8) plus the compat badge. Should Speakers also get an optional native safety limiter
   (DynamicsCompressorNode), off in migrated patches and on in new templates?
5. **Membership semantics change.** Multiple re-derived its station list from all enabled
   radios. Node makes it curated, so newly saved stations do **not** auto-appear. Is that
   acceptable, or should "Start from Multiple" patches keep an "auto-add enabled stations"
   toggle on Speakers?
6. **Platform tracks** (YouTube, SoundCloud, Bandcamp) in Node: decided, they ship as the
   Track source (platform-sources layer). What stays out of Node: "Search all" is a search,
   not a source (it is Track unlocked); DJ's Audio input placeholder is the Audio input node;
   local files don't survive a reload; summing a Track with a Station needs a bus
   (unshipped); the playing-stream budget caps simultaneous tracks; and DJ-only deck features
   (crossfader, autoplay across decks) have no Node equivalent. A per-source Loop that stops
   the next-track advance lands with a later layer.
7. **Knob captions in node bodies.** Knob captions are mono caps
   (`packages/ui/src/components/knob.tsx:207-209`), and your rule keeps mono caps to the
   wordmark, the mode toggle and DJ hardware labels. Options: (a) accept them inside reused
   effect bodies as hardware voice; (b) add an opt-in sans caption variant to the shared
   Knob, which edits `packages/ui`; (c) render node knobs without a caption and put the
   label in a sans row beside them. The proposal assumes (b) or (c) until you choose.
8. **Typography.** Geist is never loaded in radio, so mono labels render in the system sans.
   Node mode inherits this state. Fixing it is a cross-mode change you should decide
   separately.
9. **Structural FX edits dip the lane** for about 100 ms until PR 8 adds a controller method.
   Acceptable for v1?
10. **Cross-tab fights.** An old tab still running Multiple can write `"multiple"` back until
    it reloads. The listeners in §8 step 5 heal the store, but that tab's own schema rejects
    `"node"` on its next settings update, so it will show an error until reloaded.
11. **Share links.** Patches can contain user-entered stream URLs with tokens. Should share
    URLs strip non-catalogue stream URLs by default?
12. **`restoreStateOnLoad === false`.** Multiple rebuilt from enabled radios on every load.
    Rebuilding Node the same way discards an authored patch. Keep that literal behaviour, or
    keep the graph and reset only volumes and master?
13. **Recording.** Is a Recorder that writes radio streams to a file acceptable for the
    product, given station rights and terms of service?
14. **Mic in Node bypasses the main output delay** (realtime path). Mixing it with delayed
    streams on one bus would drift. The proposal marks such buses realtime and badges them.
    Is that the right trade?

## 13. Alternatives considered

**Creative-maximalist ("the radio is an instrument").** Every knob is a modulation socket
with a ring on the shared Knob, and a large v1 ships LFO, Clock, Random, Dice, Macro, File and
Mic alongside the swap. Buses become full `SoundInstance`s through a new `bus` playback-source
kind, so they get strips, faders and FX for free. It lost because its third PR bundled the
migration, every removal, about 25 node types, the palette, undo and phone tabs into one
unreviewable slice; because it added four signal tokens and changed the shared Knob, moving
away from one product across modes; and because bus sounds carry a fader that global volume
multiplies, which forces `setGlobalVolume(1)` and diverges from
`setManagedSessionMasterVolume` (`managed-playback-internals.ts:204-215`). Its best ideas
survive here: TanStack Store, the Loop guard, song-change and title-hash outputs, the Stage
tab, the Dérive static bridge, Tape Warp, Sundial and the cross-tab listener.

**Canon-native ("Single and DJ with cables added").** Station nodes are the Multiple card,
the cable is the meter, and buses wait for v2. It is the most faithful to the existing UI.
It lost because it was the least ambitious, with almost every generative idea in v2; because
its Crossfade wrote channel volume that each Station's VolumeControl also drives, without the
composed term DJ uses (`dj-deck.ts:597-620`); because its bypass-lane structural swap claimed
no engine change while `switchTo` is internal to the controller; and because it chose zustand
5 + zundo, which would be the first zustand use in `src`. Its best ideas survive here: the
Station empty state as search, cables surviving a pruned session radio, MIDI in as a mapping
projection, Macro transforms, the `midiTargetPrefix` prop, dash-first signal styling, the
bundle and migration tests, and the per-session backend policy.
