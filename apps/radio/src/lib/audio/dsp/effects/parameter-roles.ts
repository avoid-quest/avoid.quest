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
  dryWet: "wrapper-mix",
  enabled: "wrapper-bypass",
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
  autotune: withUniversalRoles({
    amount: "correction-amount",
  }),
  cheapReverb: withUniversalRoles({
    dry: "device-dry-level",
    wet: "device-wet-level",
  }),
  compressor: withUniversalRoles({
    automakeup: "automatic-gain-compensation",
    inputgain: "device-input-drive",
    makeup: "dynamics-makeup",
    mix: "device-mix",
    sidechain: "detector-sidechain",
  }),
  crusher: withUniversalRoles({
    autoGain: "automatic-gain-compensation",
    boost: "device-output-level",
  }),
  delay: withUniversalRoles({
    delayMusical: "tempo-division",
    dry: "device-dry-level",
    preSyncTimeLeft: "tempo-division",
    preSyncTimeRight: "tempo-division",
    wet: "device-wet-level",
  }),
  distortion: withUniversalRoles({
    amount: "device-input-drive",
  }),
  fold: withUniversalRoles({
    amount: "device-input-drive",
    autoGain: "automatic-gain-compensation",
    volume: "device-output-level",
  }),
  frequencySplit: withUniversalRoles({
    chains: "routing",
    crossoverFrequencies: "routing",
  }),
  fxComposite: withUniversalRoles({
    chains: "routing",
  }),
  gate: withUniversalRoles({
    floor: "gate-floor",
    sidechain: "detector-sidechain",
    threshold: "gain-reduction-threshold",
  }),
  limiter: withUniversalRoles({
    threshold: "gain-reduction-threshold",
  }),
  maximizer: withUniversalRoles({
    threshold: "gain-reduction-threshold",
  }),
  neuralAmp: withUniversalRoles({
    input: "device-input-drive",
    mix: "device-mix",
    output: "device-output-level",
  }),
  pitchShifter: withUniversalRoles(),
  plateReverb: withUniversalRoles({
    dry: "device-dry-level",
    wet: "device-wet-level",
  }),
  revamp: withUniversalRoles({
    highBellGain: "band-gain",
    highShelfGain: "band-gain",
    lowBellGain: "band-gain",
    lowShelfGain: "band-gain",
    midBellGain: "band-gain",
  }),
  stereoSplit: withUniversalRoles({
    chains: "routing",
  }),
  stereoTool: withUniversalRoles({
    volume: "device-output-level",
  }),
  tidal: withUniversalRoles({
    depth: "modulation-depth",
    rateDivision: "tempo-division",
  }),
  vocoder: withUniversalRoles({
    gain: "device-output-level",
    mix: "device-mix",
    sidechain: "detector-sidechain",
  }),
  waveshaper: withUniversalRoles({
    deviceInputGain: "device-input-drive",
    deviceOutputGain: "device-output-level",
    mix: "device-mix",
  }),
  werkstatt: withUniversalRoles({
    parameters: "code-defined-parameter",
  }),
} as const satisfies Record<
  EffectType,
  Readonly<Record<string, EffectParameterRole>>
>;
