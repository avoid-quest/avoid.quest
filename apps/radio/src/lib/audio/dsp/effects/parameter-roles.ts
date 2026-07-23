import type { EffectType } from "./types.js";

export type EffectParameterRole =
  | "automatic-gain-compensation"
  | "band-gain"
  | "code-defined-parameter"
  | "correction-amount"
  | "detector-sidechain"
  | "device-dry-level"
  | "device-input-drive"
  | "device-mix"
  | "device-output-level"
  | "device-wet-level"
  | "dynamics-makeup"
  | "gain-reduction-threshold"
  | "gate-floor"
  | "modulation-depth"
  | "routing"
  | "tempo-division"
  | "wrapper-bypass"
  | "wrapper-input-trim"
  | "wrapper-mix"
  | "wrapper-output-trim";

export const UNIVERSAL_EFFECT_PARAMETER_ROLES = {
  enabled: "wrapper-bypass",
  dryWet: "wrapper-mix",
  inputGain: "wrapper-input-trim",
  outputGain: "wrapper-output-trim",
} as const satisfies Readonly<Record<string, EffectParameterRole>>;

const withUniversalRoles = (
  native: Readonly<Record<string, EffectParameterRole>> = {}
) => ({
  ...UNIVERSAL_EFFECT_PARAMETER_ROLES,
  ...native,
});

/**
 * Signal-flow roles for controls that can otherwise look interchangeable.
 *
 * Wrapper controls surround the complete device. Device controls remain at
 * their native processing stage and deliberately compose with the wrapper.
 */
export const EFFECT_PARAMETER_ROLE_MAP = {
  plateReverb: withUniversalRoles({
    dry: "device-dry-level",
    wet: "device-wet-level",
  }),
  crusher: withUniversalRoles({
    boost: "device-output-level",
    autoGain: "automatic-gain-compensation",
  }),
  fold: withUniversalRoles({
    amount: "device-input-drive",
    volume: "device-output-level",
    autoGain: "automatic-gain-compensation",
  }),
  revamp: withUniversalRoles({
    lowShelfGain: "band-gain",
    lowBellGain: "band-gain",
    midBellGain: "band-gain",
    highBellGain: "band-gain",
    highShelfGain: "band-gain",
  }),
  delay: withUniversalRoles({
    delayMusical: "tempo-division",
    preSyncTimeLeft: "tempo-division",
    preSyncTimeRight: "tempo-division",
    dry: "device-dry-level",
    wet: "device-wet-level",
  }),
  compressor: withUniversalRoles({
    inputgain: "device-input-drive",
    makeup: "dynamics-makeup",
    automakeup: "automatic-gain-compensation",
    mix: "device-mix",
    sidechain: "detector-sidechain",
  }),
  stereoTool: withUniversalRoles({
    volume: "device-output-level",
  }),
  tidal: withUniversalRoles({
    rateDivision: "tempo-division",
    depth: "modulation-depth",
  }),
  cheapReverb: withUniversalRoles({
    dry: "device-dry-level",
    wet: "device-wet-level",
  }),
  gate: withUniversalRoles({
    threshold: "gain-reduction-threshold",
    floor: "gate-floor",
    sidechain: "detector-sidechain",
  }),
  waveshaper: withUniversalRoles({
    deviceInputGain: "device-input-drive",
    deviceOutputGain: "device-output-level",
    mix: "device-mix",
  }),
  maximizer: withUniversalRoles({
    threshold: "gain-reduction-threshold",
  }),
  vocoder: withUniversalRoles({
    gain: "device-output-level",
    mix: "device-mix",
    sidechain: "detector-sidechain",
  }),
  neuralAmp: withUniversalRoles({
    input: "device-input-drive",
    output: "device-output-level",
    mix: "device-mix",
  }),
  werkstatt: withUniversalRoles({
    parameters: "code-defined-parameter",
  }),
  autotune: withUniversalRoles({
    amount: "correction-amount",
  }),
  fxComposite: withUniversalRoles({
    chains: "routing",
  }),
  stereoSplit: withUniversalRoles({
    chains: "routing",
  }),
  frequencySplit: withUniversalRoles({
    chains: "routing",
    crossoverFrequencies: "routing",
  }),
  pitchShifter: withUniversalRoles(),
  distortion: withUniversalRoles({
    amount: "device-input-drive",
  }),
  limiter: withUniversalRoles({
    threshold: "gain-reduction-threshold",
  }),
} as const satisfies Record<
  EffectType,
  Readonly<Record<string, EffectParameterRole>>
>;
