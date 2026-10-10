# Split routing: decision record

How a Split, Stereo Split or Band Split whose branches go to different places
runs. Decided 2026-10-07 from a bench run (dev-only, at `105730ab`, since
deleted) against the criteria below, fixed before it ran.

| Option | What it is |
|---|---|
| **A** | A Web Audio split stage (`lib/audio/routing/split-stage.ts`) in front of one openDAW unit per branch with FX. |
| **B** | One openDAW unit holding the container, each cabled cell ending in a Sink into its own bus, each bus returned to Web Audio. |

## Criteria

An option that fails a gate is out.

- **G1, correctness**, on a stereo test signal at each destination, 5 repeats:
  - branch gain within 0.1 dB, both into the branch's FX and after them;
  - pan within 0.5 dB of openDAW's cell at −1, −0.5, 0, 0.5 and 1;
  - a muted or unsoloed branch at −90 dBFS or below within 50 ms, and a
    soloed one unchanged within 0.1 dB;
  - a Stereo Split port holds the other channel at −90 dBFS or below; a Band
    Split port is within 0.5 dB of openDAW's `FrequencySplit` at three tones
    per band;
  - the ports, summed, are within −60 dBFS of the rejoined container, with
    the split on and off and mix at 0, 0.5 and 1;
  - two ports meeting at one point arrive on the same sample.
- **G2, clicks**: no more than adding or removing an unrelated lane with FX,
  over 20 repeats of each edit, counted on unedited branches and other sounds
  and, for parameter edits, on the edited branch too.

If both pass, choose B only if, at N = 4 branches on two topologies or more,
its audio-thread load is lower by at least 20 % relative and 3 points of the
render budget (M1), and openDAW's DSP time (M2) is no more than 10 % worse.
Otherwise choose A. If only one passes, choose it. If neither passes, ship
Split and Stereo Split with A, recording the failed check, and refuse
diverging Band Splits with "Band Split branches must meet again" until the
cause is fixed.

## Gate results

**B fails G1, correctness**, so the load comparison (M1, M2) was not needed:

- A Sink in a cell taps before the cell's gain and mute, so branch gain, mute
  and solo never reach the ports.
- The Stereo Split and Band Split ports came back silent.
- At N = 4 branches B needs 10 of openDAW's 8 input channels.

**A passes the self-consistency checks**: its ports partition the signal,
and branch gain, pan, mute, solo and the trims hold. The run showed three
gaps, pinned by `split-stage.test.ts` and `open-splits.test.ts`, which land
with the Split routing that uses the stage. The stage distributes each
branch's input; the compiled cables place the wet input trim before its
effects and gain, balance, mute, solo, mix and output trim at its exit:

- Pan read about 3 dB off openDAW's cell: branch cables use openDAW's linear
  balance (`StereoMatrix.panningToGains`), not `StereoPannerNode`.
- Trims did not follow openDAW's wrapper: the input trim now acts on the wet
  path only, and the output trim stays at unity while the split is off.
- Band Split ports summed to within −39 to −45 dBFS of openDAW's rejoined
  container, not −60. The stage's bands are complementary, so its ports sum
  back to the input itself: an offline render checks that below −60 dBFS. The
  rest is openDAW's own crossover, which was not re-measured.

## Original beta verification

- **Band Split against openDAW's container, ≤ −60 dBFS:** run in a real
  browser, with the same config in openDAW's `FrequencySplit`. The bench
  measured −39 to −45 dBFS; the offline render only checks the stage against
  its own input.
- **G2, clicks:** count clicks per edit against the baseline, in a real
  browser. The bench run recorded no click counts.

## Browser recheck, 2026-10-10

Tested `cb783dd11596d73fc6d6af97abd2eafa9bddd35d` in T3's Chromium
154 browser, cross-origin isolated, at 48 kHz. The input summed five sine
oscillators at 73, 277, 997, 3311 and 8111 Hz, through a gain of 0.15. It was
mono duplicated onto the two monitored channels; this measures summed output,
not stereo isolation.

The source fed both the production `createSplitStage` and the production
`OfficialOpenDawRuntime` with its actual FrequencySplit container. All stage
ports were summed and passed through a second, effect-free sound in the same
openDAW runtime. Both paths therefore used the same monitoring engine, with
four monitoring channels occupied in total. An AudioWorklet captured the two
outputs simultaneously. No speaker output was needed. Each configuration
settled for 150 ms, then five captures of 9600 samples measured the RMS
sample difference at zero lag. The four-band comparison also checked offsets
of ±512 samples; its best match was at zero.

Configured crossovers were `[200]`, `[200, 1000]` and `[200, 1000, 5000]`,
with two, three and four unity-gain, centered, unmuted chains respectively.
The effect mix was 1. Results across five captures:

- Two bands enabled: −25.905 to −25.904 dBFS — **fails** the −60 dBFS gate.
- Three bands enabled: −25.854 to −25.854 dBFS — **fails**.
- Four bands enabled: −157.546 to −157.254 dBFS — passes this comparison.
- Disabled controls: below −157 dBFS for all three band counts.

The adapter supplies 20 kHz for unused native crossovers and mutes unused
native cells. The Web Audio stage instead gives its last cabled band the
entire remainder. The enabled two-/three-band discrepancy is reproducible;
a sum-to-input test does not establish parity with that native container.
This recheck establishes failure at full mix, which is sufficient to reject
A for divergent Band Splits. It does not claim the rest of G1, partial mixes,
per-port frequency response, or G2 click counts passed.

## Decision

**Use the documented fallback.** B failed G1, and A now demonstrably fails
Band Split parity. The compiler refuses any Band Split requiring the external
stage with **"Band Split branches must meet again"**. This includes branches
sent to different outputs or tapped where a closed container cannot implement
them. The refusal never substitutes unfiltered audio. Rejoined Band Splits
continue through the existing container path.

Split and Stereo Split retain A as the original fallback specifies. G2 click
counts and physical listening remain unverified; this restriction does not
waive those release checks. Re-enable divergent Band Splits only after fixing
the mismatch and recording the complete required measurements, including all
supported band counts and dry/wet settings.

A needs no null bus, no output 0 and no bus registrations. B is not built.
