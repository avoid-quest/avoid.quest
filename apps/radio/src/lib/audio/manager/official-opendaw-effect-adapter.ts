import { UUID } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import { getCachedNamModel } from "../dsp/effects/nam-model-store.js";
import {
  isOfficialOpenDawEffect,
  OPENDAW_FACTORY_KEYS,
} from "../dsp/effects/official-opendaw-mapping.js";
import {
  AUTOTUNE_KEYS,
  AUTOTUNE_SCALES,
  type EffectChainConfig,
  type EffectConfig,
  OPENDAW_DELAY_FRACTIONS,
  OPENDAW_TIDAL_FRACTIONS,
  TEMPO_DIVISIONS,
  type TempoDivision,
} from "../dsp/effects/types.js";

type PrimitiveField = {
  getValue?(): boolean | number | string;
  setValue(value: boolean | number | string): void;
};

type PointerField = {
  defer(): void;
  refer(target: unknown): void;
};

const PRIMITIVE_FIELD_KEYS = [
  "amount",
  "attack",
  "autoattack",
  "automakeup",
  "autorelease",
  "bandwidth",
  "bandCount",
  "bits",
  "boost",
  "carrierMaxFreq",
  "carrierMinFreq",
  "channelOffset",
  "cross",
  "crossover1",
  "crossover2",
  "crossover3",
  "crush",
  "damp",
  "damping",
  "decay",
  "decayDiffusion1",
  "decayDiffusion2",
  "delayMusical",
  "delayMillis",
  "depth",
  "drive",
  "dry",
  "enabled",
  "envAttack",
  "envRelease",
  "equation",
  "excursionDepth",
  "excursionRate",
  "feedback",
  "filter",
  "floor",
  "frequency",
  "gain",
  "hold",
  "index",
  "inputDiffusion1",
  "inputDiffusion2",
  "inputGain",
  "inputgain",
  "inverse",
  "invertL",
  "invertR",
  "key",
  "knee",
  "label",
  "lfoDepth",
  "lfoSpeed",
  "lookahead",
  "makeup",
  "mix",
  "modulatorMaxFreq",
  "modulatorMinFreq",
  "modulatorSource",
  "mono",
  "mute",
  "offset",
  "order",
  "outputGain",
  "overSampling",
  "pan",
  "panning",
  "panningMixing",
  "preDelay",
  "preMillisTimeLeft",
  "preMillisTimeRight",
  "preSyncTimeLeft",
  "preSyncTimeRight",
  "q",
  "qEnd",
  "qStart",
  "rate",
  "ratio",
  "release",
  "retune",
  "return",
  "scale",
  "shift",
  "slope",
  "smooth",
  "solo",
  "stereo",
  "swap",
  "symmetry",
  "threshold",
  "value",
  "volume",
  "wet",
] as const;

type PrimitiveFieldKey = (typeof PRIMITIVE_FIELD_KEYS)[number];
type PointerFieldKey = "model" | "sideChain";

type PrimitiveBoxFields = Partial<Record<PrimitiveFieldKey, PrimitiveField>>;
type PointerBoxFields = Partial<Record<PointerFieldKey, PointerField>>;

interface BoxLike extends PrimitiveBoxFields, PointerBoxFields {
  address?: { uuid: Uint8Array };
  audioEffects?: HostField;
  composite?: { refer(target: unknown): void };
  delete(): void;
  entries?: {
    incoming?: unknown[];
    pointerHub?: { incoming(): Array<{ box: BoxLike }> };
  };
  highBell?: BoxLike;
  highPass?: BoxLike;
  highShelf?: BoxLike;
  lowBell?: BoxLike;
  lowPass?: BoxLike;
  lowShelf?: BoxLike;
  midBell?: BoxLike;
  parameters?: {
    pointerHub?: { filter(): Array<{ box: BoxLike }> };
  };
}

type HostField = unknown;

type AdapterModules = {
  boxes: typeof import("@opendaw/studio-boxes");
  core: typeof import("@opendaw/studio-core");
};

export type OfficialEffectGroup = {
  children: OfficialEffectGroup[];
  config: EffectConfig;
  created: BoxLike[];
  device: BoxLike;
  inputTrim: BoxLike | null;
  wrapper: BoxLike | null;
  outputTrim: BoxLike | null;
};

type CreateContext = AdapterModules & {
  project: Project;
  bpm: number;
};

function field(box: BoxLike, key: PrimitiveFieldKey): PrimitiveField {
  const candidate = box[key];
  if (
    candidate &&
    typeof candidate === "object" &&
    "setValue" in candidate &&
    typeof candidate.setValue === "function"
  ) {
    return candidate;
  }
  throw new Error(`openDAW box is missing required field "${key}"`);
}

function optionalPointer(
  box: BoxLike,
  key: PointerFieldKey
): PointerField | undefined {
  const candidate = box[key];
  return candidate &&
    typeof candidate === "object" &&
    "refer" in candidate &&
    typeof candidate.refer === "function" &&
    "defer" in candidate &&
    typeof candidate.defer === "function"
    ? (candidate as PointerField)
    : undefined;
}

function requiredPointer(box: BoxLike, key: PointerFieldKey): PointerField {
  const candidate = optionalPointer(box, key);
  if (!candidate) {
    throw new Error(`openDAW box is missing required pointer "${key}"`);
  }
  return candidate;
}

function set(
  box: BoxLike,
  key: PrimitiveFieldKey,
  value: boolean | number | string
): void {
  field(box, key).setValue(value);
}

function db(gain: number): number {
  return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}

export function usesDirectOfficialEffectLayout(
  config: EffectConfig
): boolean {
  // The generic wrapper adds six openDAW processors. Default Autotune needs
  // none of them, so keep its native device directly in the host chain.
  return (
    config.enabled &&
    config.type === "autotune" &&
    config.dryWet === 1 &&
    config.inputGain === 1 &&
    config.outputGain === 1
  );
}

function divisionIndex(
  division: string | undefined,
  fractions: readonly string[]
): number {
  const index = fractions.indexOf(division ?? "1/4");
  return index < 0 ? 0 : index;
}

function configureRevamp(box: BoxLike, config: EffectConfig): void {
  if (config.type !== "revamp") {
    return;
  }
  for (const [prefix, key] of [
    ["highPass", "highPass"],
    ["lowShelf", "lowShelf"],
    ["lowBell", "lowBell"],
    ["midBell", "midBell"],
    ["highBell", "highBell"],
    ["highShelf", "highShelf"],
    ["lowPass", "lowPass"],
  ] as const) {
    const section = box[key];
    if (!section) {
      throw new Error(`openDAW Revamp box is missing section "${key}"`);
    }
    const configRecord = config as unknown as Record<string, unknown>;
    set(section, "enabled", Boolean(configRecord[`${prefix}Enabled`]));
    set(
      section,
      "frequency",
      Number(configRecord[`${prefix}Frequency`] ?? 1000)
    );
    if (`${prefix}Gain` in configRecord) {
      set(section, "gain", Number(configRecord[`${prefix}Gain`]));
    }
    if (`${prefix}Q` in configRecord) {
      set(section, "q", Number(configRecord[`${prefix}Q`]));
    }
    if (`${prefix}Order` in configRecord) {
      set(
        section,
        "order",
        Math.max(0, Math.min(3, Number(configRecord[`${prefix}Order`]) - 1))
      );
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive discriminated-union adapter for the upstream catalog
function configureDevice(
  box: BoxLike,
  config: EffectConfig,
  bpm: number
): void {
  set(box, "enabled", true);
  switch (config.type) {
    case "plateReverb":
      set(box, "preDelay", config.preDelayMillis);
      for (const key of [
        "bandwidth",
        "inputDiffusion1",
        "inputDiffusion2",
        "decay",
        "decayDiffusion1",
        "decayDiffusion2",
        "damping",
        "excursionRate",
        "excursionDepth",
      ] as const) {
        set(box, key, config[key]);
      }
      set(box, "dry", config.dry ?? 0);
      set(box, "wet", config.wet ?? -6);
      break;
    case "crusher":
      set(box, "crush", config.crush);
      set(box, "bits", config.bitDepth);
      set(box, "boost", config.boost);
      set(box, "mix", 1);
      break;
    case "fold":
      set(box, "drive", config.amount);
      set(
        box,
        "volume",
        config.volume - (config.autoGain ? Math.max(0, config.amount) / 2 : 0)
      );
      set(box, "overSampling", { 2: 0, 4: 1, 8: 2 }[config.oversample]);
      break;
    case "revamp":
      configureRevamp(box, config);
      break;
    case "delay":
      set(
        box,
        "delayMusical",
        (config.delayMusical ?? "1/4") === "Off"
          ? 0
          : divisionIndex(config.delayMusical ?? "1/4", OPENDAW_DELAY_FRACTIONS)
      );
      set(box, "delayMillis", config.delayMillis ?? config.delayTime * 1000);
      set(box, "feedback", config.feedback);
      set(box, "cross", config.cross ?? config.crossFeedback ?? 0);
      set(
        box,
        "preSyncTimeLeft",
        divisionIndex(config.preSyncTimeLeft ?? "1/16", OPENDAW_DELAY_FRACTIONS)
      );
      set(box, "preMillisTimeLeft", config.preMillisTimeLeft ?? 0);
      set(
        box,
        "preSyncTimeRight",
        divisionIndex(config.preSyncTimeRight ?? "Off", OPENDAW_DELAY_FRACTIONS)
      );
      set(box, "preMillisTimeRight", config.preMillisTimeRight ?? 0);
      set(box, "filter", config.filter ?? 0);
      set(box, "lfoSpeed", config.lfoSpeed ?? config.lfoRate ?? 0);
      set(box, "lfoDepth", config.lfoDepth ?? 0);
      set(box, "dry", config.dry ?? 0);
      set(box, "wet", config.wet ?? -6);
      break;
    case "compressor":
      set(box, "lookahead", config.lookahead);
      set(box, "automakeup", config.automakeup ?? config.autoMakeup);
      set(box, "autoattack", config.autoattack ?? config.autoAttack);
      set(box, "autorelease", config.autorelease ?? config.autoRelease);
      set(box, "inputgain", config.inputgain ?? 0);
      set(box, "threshold", config.threshold);
      set(box, "ratio", config.ratio);
      set(box, "knee", config.knee);
      set(box, "attack", config.attack);
      set(box, "release", config.release);
      set(box, "makeup", config.makeup);
      set(box, "mix", config.mix);
      break;
    case "stereoTool":
      set(box, "volume", config.volume);
      set(box, "panning", config.panning ?? 0);
      set(box, "panningMixing", config.panLaw === "linear" ? 0 : 1);
      set(box, "stereo", config.stereo);
      set(box, "invertL", config.invertL);
      set(box, "invertR", config.invertR);
      set(box, "swap", config.swap);
      break;
    case "tidal": {
      const secondsPerBeat = 60 / Math.max(30, bpm);
      const closestDivision = TEMPO_DIVISIONS.reduce((best, division) => {
        const [numerator, denominator] = division.split("/").map(Number);
        const duration = secondsPerBeat * 4 * (numerator / denominator);
        const bestParts = best.split("/").map(Number);
        const bestDuration = secondsPerBeat * 4 * (bestParts[0] / bestParts[1]);
        return Math.abs(duration - 1 / config.rate) <
          Math.abs(bestDuration - 1 / config.rate)
          ? division
          : best;
      }, "1/4" as TempoDivision);
      set(
        box,
        "rate",
        divisionIndex(
          config.rateDivision ?? closestDivision,
          OPENDAW_TIDAL_FRACTIONS
        )
      );
      set(box, "depth", config.depth);
      set(box, "slope", config.slope);
      set(box, "symmetry", config.symmetry);
      set(box, "offset", ((config.offset + 180) % 360) - 180);
      set(box, "channelOffset", ((config.channelOffset + 180) % 360) - 180);
      break;
    }
    case "cheapReverb":
      set(box, "decay", config.decay ?? 0.5);
      set(box, "preDelay", config.preDelay ?? 0.02);
      set(box, "damp", config.damp ?? 0.5);
      set(box, "filter", config.filter ?? 0);
      set(box, "dry", config.dry ?? 0);
      set(box, "wet", config.wet ?? -3);
      break;
    case "gate":
      set(box, "threshold", config.threshold);
      set(box, "return", config.return ?? 0);
      set(box, "attack", config.attack);
      set(box, "hold", config.hold);
      set(box, "release", config.release);
      set(box, "floor", config.floor);
      set(box, "inverse", config.inverse);
      break;
    case "waveshaper":
      set(box, "equation", config.equation ?? "hardclip");
      set(box, "inputGain", config.deviceInputGain ?? 0);
      set(box, "outputGain", config.deviceOutputGain ?? 0);
      set(box, "mix", config.mix ?? 1);
      break;
    case "maximizer":
      set(box, "threshold", config.threshold);
      set(box, "lookahead", config.lookaheadEnabled ?? config.lookahead > 0);
      break;
    case "vocoder":
      set(box, "carrierMinFreq", config.carrierMinFreq ?? 100);
      set(box, "carrierMaxFreq", config.carrierMaxFreq ?? 12_000);
      set(box, "modulatorMinFreq", config.modulatorMinFreq ?? 100);
      set(box, "modulatorMaxFreq", config.modulatorMaxFreq ?? 12_000);
      set(box, "qStart", config.qStart ?? 20);
      set(box, "qEnd", config.qEnd ?? 2);
      set(box, "envAttack", config.envAttack ?? 5);
      set(box, "envRelease", config.envRelease ?? 30);
      set(box, "gain", config.gain ?? 0);
      set(box, "mix", config.mix ?? 1);
      set(box, "bandCount", config.bandCount ?? config.bands);
      set(
        box,
        "modulatorSource",
        config.modulatorSource ??
          (config.modulator === "noise" ? "noise-pink" : config.modulator)
      );
      break;
    case "neuralAmp":
      set(box, "inputGain", config.input);
      set(box, "outputGain", config.output);
      set(box, "mono", config.mono ?? true);
      set(box, "mix", config.mix ?? 1);
      break;
    case "werkstatt":
      // ScriptCompiler.compile owns code headers and declaration boxes.
      break;
    case "autotune": {
      set(box, "key", Math.max(0, AUTOTUNE_KEYS.indexOf(config.key as never)));
      let scale = config.scale;
      if (scale === "pentatonicMajor") {
        scale = "majorPentatonic";
      } else if (scale === "pentatonicMinor") {
        scale = "minorPentatonic";
      }
      set(box, "scale", Math.max(0, AUTOTUNE_SCALES.indexOf(scale as never)));
      set(box, "amount", config.amount);
      set(box, "retune", config.retuneAmount ?? config.retune / 80);
      set(box, "shift", config.shift);
      set(box, "smooth", config.smooth ?? config.smoothing);
      break;
    }
    case "fxComposite":
    case "stereoSplit":
    case "frequencySplit":
      set(box, "dry", Number.NEGATIVE_INFINITY);
      set(box, "wet", 0);
      if (config.type === "frequencySplit") {
        set(box, "crossover1", config.crossoverFrequencies[0] ?? 200);
        set(box, "crossover2", config.crossoverFrequencies[1] ?? 20_000);
        set(box, "crossover3", config.crossoverFrequencies[2] ?? 20_000);
      }
      break;
    default:
      throw new Error(`Unsupported official openDAW effect: ${config.type}`);
  }
}

function createCell(
  { boxes, project }: CreateContext,
  composite: BoxLike,
  chain: EffectChainConfig,
  created?: BoxLike[]
): BoxLike {
  const cell = boxes.AudioEffectCompositeCellBox.create(
    project.boxGraph,
    UUID.generate(),
    (box) => {
      box.composite.refer(composite.entries as never);
      box.index.setValue(chain.order);
      box.label.setValue(chain.name);
      box.gain.setValue(db(chain.gain));
      box.pan.setValue(chain.pan);
      box.mute.setValue(chain.muted);
      box.solo.setValue(chain.solo);
    }
  ) as unknown as BoxLike;
  created?.push(cell);
  return cell;
}

function fixedCells(composite: BoxLike): BoxLike[] {
  const entries = composite.entries as
    | {
        pointerHub?: {
          incoming(): Array<{ box: BoxLike }>;
        };
      }
    | undefined;
  return (
    entries?.pointerHub
      ?.incoming()
      .map(({ box }) => box)
      .sort(
        (left, right) =>
          Number((left.index as unknown as { getValue(): number }).getValue()) -
          Number((right.index as unknown as { getValue(): number }).getValue())
      ) ?? []
  );
}

function createNestedChains(
  context: CreateContext,
  composite: BoxLike,
  config: Extract<
    EffectConfig,
    { type: "fxComposite" | "stereoSplit" | "frequencySplit" }
  >,
  created: BoxLike[],
  children: OfficialEffectGroup[]
): void {
  const cells =
    config.type === "fxComposite"
      ? config.chains
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((chain) => createCell(context, composite, chain, created))
      : fixedCells(composite);

  if (config.type === "frequencySplit") {
    for (const cell of cells) {
      set(cell, "mute", true);
    }
  }

  config.chains
    .slice()
    .sort((left, right) => left.order - right.order)
    .forEach((chain, index) => {
      const cell = cells[index];
      if (!cell) {
        return;
      }
      set(cell, "label", chain.name);
      set(cell, "gain", db(chain.gain));
      set(cell, "pan", chain.pan);
      set(cell, "mute", chain.muted);
      set(cell, "solo", chain.solo);
      chain.effects
        .slice()
        .sort((left, right) => left.order - right.order)
        .forEach((effect, effectIndex) => {
          const nested = createOfficialEffectGroup(
            context,
            effect,
            cell.audioEffects,
            effectIndex * 2
          );
          children.push(nested);
          created.push(...nested.created);
        });
    });
}

function insert(
  { core, project }: CreateContext,
  host: HostField,
  factory: keyof typeof core.EffectFactories.AudioNamed,
  index: number
): BoxLike {
  return project.api.insertEffect(
    host as never,
    core.EffectFactories.AudioNamed[factory],
    index
  ) as unknown as BoxLike;
}

function createTrim(
  context: CreateContext,
  host: HostField,
  index: number,
  gain: number,
  label: string,
  created: BoxLike[]
): BoxLike {
  const trim = insert(context, host, "StereoTool", index);
  set(trim, "label", label);
  set(trim, "volume", db(gain));
  set(trim, "enabled", true);
  created.push(trim);
  return trim;
}

export function createOfficialEffectGroup(
  context: CreateContext,
  config: EffectConfig,
  host: HostField,
  index: number
): OfficialEffectGroup {
  if (!isOfficialOpenDawEffect(config)) {
    throw new Error(`Radio-only effect cannot use openDAW: ${config.type}`);
  }

  const created: BoxLike[] = [];
  const children: OfficialEffectGroup[] = [];
  const factory = OPENDAW_FACTORY_KEYS[config.type];
  if (usesDirectOfficialEffectLayout(config)) {
    const device = insert(context, host, factory, index);
    created.push(device);
    configureDevice(device, config, context.bpm);
    return {
      children,
      config,
      created,
      device,
      inputTrim: null,
      wrapper: null,
      outputTrim: null,
    };
  }

  const wrapper = insert(context, host, "AudioEffectComposite", index);
  created.push(wrapper);
  set(wrapper, "label", `Radio wrapper: ${config.type}`);
  set(wrapper, "enabled", config.enabled);
  set(wrapper, "dry", db(1 - config.dryWet));
  set(wrapper, "wet", db(config.dryWet));

  const wetCell = createCell(
    context,
    wrapper,
    {
      id: `${config.id}:wet`,
      name: "Wet",
      order: 0,
      gain: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
    },
    created
  );
  const inputTrim = createTrim(
    context,
    wetCell.audioEffects,
    0,
    config.inputGain,
    "Input trim",
    created
  );

  const device = insert(context, wetCell.audioEffects, factory, 1);
  created.push(device);
  configureDevice(device, config, context.bpm);
  const modelData =
    config.type === "neuralAmp"
      ? (config.modelData ?? getCachedNamModel(config.modelId))
      : null;
  if (config.type === "neuralAmp" && modelData) {
    const model = context.boxes.NeuralAmpModelBox.create(
      context.project.boxGraph,
      UUID.generate(),
      (box) => {
        box.label.setValue(config.modelName ?? config.modelId ?? "Local model");
        box.model.setValue(modelData);
      }
    ) as unknown as BoxLike;
    created.push(model);
    requiredPointer(device, "model").refer(model);
  }
  if (
    config.type === "fxComposite" ||
    config.type === "stereoSplit" ||
    config.type === "frequencySplit"
  ) {
    createNestedChains(context, device, config, created, children);
  }

  const outputTrim = createTrim(
    context,
    host,
    index + 1,
    config.type === "crusher" && !config.autoGain
      ? config.outputGain * 10 ** (config.boost / 40)
      : config.outputGain,
    "Output trim",
    created
  );
  set(outputTrim, "enabled", config.enabled);

  return {
    children,
    config,
    created,
    device,
    inputTrim,
    wrapper,
    outputTrim,
  };
}

export function updateOfficialEffectGroup(
  group: OfficialEffectGroup,
  config: EffectConfig,
  bpm: number
): void {
  if (group.wrapper === null) {
    if (!usesDirectOfficialEffectLayout(config)) {
      throw new Error("Direct openDAW effect layout requires unity controls");
    }
    group.config = config;
    configureDevice(group.device, config, bpm);
    return;
  }
  if (!(group.inputTrim && group.outputTrim)) {
    throw new Error("Wrapped openDAW effect layout is incomplete");
  }
  group.config = config;
  set(group.wrapper, "enabled", config.enabled);
  set(group.wrapper, "dry", db(1 - config.dryWet));
  set(group.wrapper, "wet", db(config.dryWet));
  set(group.inputTrim, "volume", db(config.inputGain));
  configureDevice(group.device, config, bpm);
  set(
    group.outputTrim,
    "volume",
    db(
      config.type === "crusher" && !config.autoGain
        ? config.outputGain * 10 ** (config.boost / 40)
        : config.outputGain
    )
  );
  set(group.outputTrim, "enabled", config.enabled);
  if ("chains" in config) {
    const cells = fixedCells(group.device);
    config.chains
      .slice()
      .sort((left, right) => left.order - right.order)
      .forEach((chain, index) => {
        const cell = cells[index];
        if (cell) {
          set(cell, "label", chain.name);
          set(cell, "gain", db(chain.gain));
          set(cell, "pan", chain.pan);
          set(cell, "mute", chain.muted);
          set(cell, "solo", chain.solo);
        }
      });
  }
}

export function restoreWerkstattParameterValues(
  group: OfficialEffectGroup,
  values: Readonly<Record<string, number>>
): void {
  const parameters = group.device.parameters as
    | {
        pointerHub?: {
          filter(): Array<{ box: BoxLike }>;
        };
      }
    | undefined;
  for (const { box } of parameters?.pointerHub?.filter() ?? []) {
    const label = field(box, "label")?.getValue?.();
    if (typeof label !== "string") {
      continue;
    }
    const value = values[label];
    if (typeof value === "number" && Number.isFinite(value)) {
      set(box, "value", value);
    }
  }
}

export function deleteOfficialEffectGroups(
  groups: readonly OfficialEffectGroup[]
): void {
  const deleted = new Set<BoxLike>();
  for (const group of [...groups].reverse()) {
    for (const box of [...group.created].reverse()) {
      if (!deleted.has(box)) {
        deleted.add(box);
        box.delete();
      }
    }
  }
}

export function bindOfficialSidechain(
  group: OfficialEffectGroup,
  target: unknown | null
): void {
  const sidechain = optionalPointer(group.device, "sideChain");
  if (!sidechain) {
    return;
  }
  if (target === null) {
    sidechain.defer();
  } else {
    sidechain.refer(target);
  }
}

export function createMasterRack(
  context: CreateContext,
  host: HostField
): {
  root: BoxLike;
  dry: BoxLike;
  wet: BoxLike;
} {
  const root = insert(context, host, "AudioEffectComposite", 0);
  set(root, "label", "Radio Effects");
  set(root, "enabled", true);
  set(root, "dry", Number.NEGATIVE_INFINITY);
  set(root, "wet", 0);
  const dry = createCell(context, root, {
    id: "master-dry",
    name: "Dry",
    order: 0,
    gain: 0,
    pan: 0,
    muted: false,
    solo: false,
    effects: [],
  });
  const wet = createCell(context, root, {
    id: "master-wet",
    name: "Wet",
    order: 1,
    gain: 1,
    pan: 0,
    muted: false,
    solo: false,
    effects: [],
  });
  return { root, dry, wet };
}

export function setMasterRackDryWet(
  rack: { dry: BoxLike; wet: BoxLike },
  value: number
): void {
  const wet = Math.max(0, Math.min(1, value));
  set(rack.dry, "gain", db(1 - wet));
  set(rack.wet, "gain", db(wet));
}
