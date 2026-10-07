import { gainToDb } from "@opendaw/lib-dsp";
import { asInstanceOf, UUID } from "@opendaw/lib-std";
import type {
  AudioEffectCompositeBox,
  AudioEffectCompositeCellBox,
  AudioUnitBox,
  NeuralAmpModelBox,
  RevampDeviceBox,
  StereoToolDeviceBox,
} from "@opendaw/studio-boxes";
import type { EffectBox, Project } from "@opendaw/studio-core";
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
import { usesDirectEffectLayout } from "../dsp/routing/effect-tree.js";

export type OfficialEffectHost = Parameters<Project["api"]["insertEffect"]>[0];
export type OfficialEffectGroup = {
  children: OfficialEffectGroup[];
  cells: Map<string, AudioEffectCompositeCellBox>;
  config: EffectConfig;
  device: EffectBox;
  model: NeuralAmpModelBox | null;
  signalTrim: StereoToolDeviceBox | null;
  inputTrim: StereoToolDeviceBox | null;
  wrapper: AudioEffectCompositeBox | null;
  outputTrim: StereoToolDeviceBox | null;
};

type CreateContext = {
  adapters: typeof import("@opendaw/studio-adapters");
  boxes: typeof import("@opendaw/studio-boxes");
  core: typeof import("@opendaw/studio-core");
  project: Project;
  bpm: number;
};

function outputGain(config: EffectConfig): number {
  return config.type === "crusher" && !config.autoGain
    ? config.outputGain * 10 ** (config.boost / 40)
    : config.outputGain;
}

function optionIndex(
  division: string | undefined,
  fractions: readonly string[]
): number {
  const index = fractions.indexOf(division ?? "1/4");
  return index < 0 ? 0 : index;
}

function configureRevamp(
  box: RevampDeviceBox,
  config: Extract<EffectConfig, { type: "revamp" }>
): void {
  for (const key of ["highPass", "lowPass"] as const) {
    box[key].enabled.setValue(config[`${key}Enabled`]);
    box[key].frequency.setValue(config[`${key}Frequency`]);
    box[key].q.setValue(config[`${key}Q`]);
    box[key].order.setValue(
      Math.max(0, Math.min(3, config[`${key}Order`] - 1))
    );
  }
  for (const key of [
    "lowShelf",
    "highShelf",
    "lowBell",
    "midBell",
    "highBell",
  ] as const) {
    box[key].enabled.setValue(config[`${key}Enabled`]);
    box[key].frequency.setValue(config[`${key}Frequency`]);
    box[key].gain.setValue(config[`${key}Gain`]);
  }
  for (const key of ["lowBell", "midBell", "highBell"] as const) {
    box[key].q.setValue(config[`${key}Q`]);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive discriminated-union adapter for the upstream catalog
function configureDevice(
  context: CreateContext,
  box: EffectBox,
  config: EffectConfig,
  bpm: number
): void {
  const { boxes } = context;
  box.enabled.setValue(config.enabled);
  switch (config.type) {
    case "plateReverb": {
      const device = asInstanceOf(box, boxes.DattorroReverbDeviceBox);
      device.preDelay.setValue(config.preDelayMillis);
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
        device[key].setValue(config[key]);
      }
      device.dry.setValue(config.dry ?? 0);
      device.wet.setValue(config.wet ?? -6);
      break;
    }
    case "crusher": {
      const device = asInstanceOf(box, boxes.CrusherDeviceBox);
      device.crush.setValue(config.crush);
      device.bits.setValue(config.bitDepth);
      device.boost.setValue(config.boost);
      device.mix.setValue(1);
      break;
    }
    case "fold": {
      const device = asInstanceOf(box, boxes.FoldDeviceBox);
      device.drive.setValue(config.amount);
      device.volume.setValue(
        config.volume - (config.autoGain ? Math.max(0, config.amount) / 2 : 0)
      );
      device.overSampling.setValue({ 2: 0, 4: 1, 8: 2 }[config.oversample]);
      break;
    }
    case "revamp":
      configureRevamp(asInstanceOf(box, boxes.RevampDeviceBox), config);
      break;
    case "delay": {
      const device = asInstanceOf(box, boxes.DelayDeviceBox);
      device.delayMusical.setValue(
        (config.delayMusical ?? "1/4") === "Off"
          ? 0
          : optionIndex(config.delayMusical ?? "1/4", OPENDAW_DELAY_FRACTIONS)
      );
      device.delayMillis.setValue(
        config.delayMillis ?? config.delayTime * 1000
      );
      device.feedback.setValue(config.feedback);
      device.cross.setValue(config.cross ?? config.crossFeedback ?? 0);
      device.preSyncTimeLeft.setValue(
        optionIndex(config.preSyncTimeLeft ?? "1/16", OPENDAW_DELAY_FRACTIONS)
      );
      device.preMillisTimeLeft.setValue(config.preMillisTimeLeft ?? 0);
      device.preSyncTimeRight.setValue(
        optionIndex(config.preSyncTimeRight ?? "Off", OPENDAW_DELAY_FRACTIONS)
      );
      device.preMillisTimeRight.setValue(config.preMillisTimeRight ?? 0);
      device.filter.setValue(config.filter ?? 0);
      device.lfoSpeed.setValue(config.lfoSpeed ?? config.lfoRate ?? 0);
      device.lfoDepth.setValue(config.lfoDepth ?? 0);
      device.dry.setValue(config.dry ?? 0);
      device.wet.setValue(config.wet ?? -6);
      break;
    }
    case "compressor": {
      const device = asInstanceOf(box, boxes.CompressorDeviceBox);
      device.lookahead.setValue(config.lookahead);
      device.automakeup.setValue(config.automakeup ?? config.autoMakeup);
      device.autoattack.setValue(config.autoattack ?? config.autoAttack);
      device.autorelease.setValue(config.autorelease ?? config.autoRelease);
      device.inputgain.setValue(config.inputgain ?? 0);
      device.threshold.setValue(config.threshold);
      device.ratio.setValue(config.ratio);
      device.knee.setValue(config.knee);
      device.attack.setValue(config.attack);
      device.release.setValue(config.release);
      device.makeup.setValue(config.makeup);
      device.mix.setValue(config.mix);
      break;
    }
    case "stereoTool": {
      const device = asInstanceOf(box, boxes.StereoToolDeviceBox);
      device.volume.setValue(config.volume);
      device.panning.setValue(config.panning ?? 0);
      device.panningMixing.setValue(config.panLaw === "linear" ? 0 : 1);
      device.stereo.setValue(config.stereo);
      device.invertL.setValue(config.invertL);
      device.invertR.setValue(config.invertR);
      device.swap.setValue(config.swap);
      break;
    }
    case "tidal": {
      const device = asInstanceOf(box, boxes.TidalDeviceBox);
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
      device.rate.setValue(
        optionIndex(
          config.rateDivision ?? closestDivision,
          OPENDAW_TIDAL_FRACTIONS
        )
      );
      device.depth.setValue(config.depth);
      device.slope.setValue(config.slope);
      device.symmetry.setValue(config.symmetry);
      device.offset.setValue(((config.offset + 180) % 360) - 180);
      device.channelOffset.setValue(((config.channelOffset + 180) % 360) - 180);
      break;
    }
    case "cheapReverb": {
      const device = asInstanceOf(box, boxes.ReverbDeviceBox);
      device.decay.setValue(config.decay ?? 0.5);
      device.preDelay.setValue(config.preDelay ?? 0.02);
      device.damp.setValue(config.damp ?? 0.5);
      device.filter.setValue(config.filter ?? 0);
      device.dry.setValue(config.dry ?? 0);
      device.wet.setValue(config.wet ?? -3);
      break;
    }
    case "gate": {
      const device = asInstanceOf(box, boxes.GateDeviceBox);
      device.threshold.setValue(config.threshold);
      device.return.setValue(config.return ?? 0);
      device.attack.setValue(config.attack);
      device.hold.setValue(config.hold);
      device.release.setValue(config.release);
      device.floor.setValue(config.floor);
      device.inverse.setValue(config.inverse);
      break;
    }
    case "waveshaper": {
      const device = asInstanceOf(box, boxes.WaveshaperDeviceBox);
      device.equation.setValue(config.equation ?? "hardclip");
      device.inputGain.setValue(config.deviceInputGain ?? 0);
      device.outputGain.setValue(config.deviceOutputGain ?? 0);
      device.mix.setValue(config.mix ?? 1);
      break;
    }
    case "maximizer": {
      const device = asInstanceOf(box, boxes.MaximizerDeviceBox);
      device.threshold.setValue(config.threshold);
      device.lookahead.setValue(
        config.lookaheadEnabled ?? config.lookahead > 0
      );
      break;
    }
    case "vocoder": {
      const device = asInstanceOf(box, boxes.VocoderDeviceBox);
      device.carrierMinFreq.setValue(config.carrierMinFreq ?? 100);
      device.carrierMaxFreq.setValue(config.carrierMaxFreq ?? 12_000);
      device.modulatorMinFreq.setValue(config.modulatorMinFreq ?? 100);
      device.modulatorMaxFreq.setValue(config.modulatorMaxFreq ?? 12_000);
      device.qStart.setValue(config.qStart ?? 20);
      device.qEnd.setValue(config.qEnd ?? 2);
      device.envAttack.setValue(config.envAttack ?? 5);
      device.envRelease.setValue(config.envRelease ?? 30);
      device.gain.setValue(config.gain ?? 0);
      device.mix.setValue(config.mix ?? 1);
      device.bandCount.setValue(config.bandCount ?? config.bands);
      device.modulatorSource.setValue(
        config.modulatorSource ??
          (config.modulator === "noise" ? "noise-pink" : config.modulator)
      );
      break;
    }
    case "neuralAmp": {
      const device = asInstanceOf(box, boxes.NeuralAmpDeviceBox);
      device.inputGain.setValue(config.input);
      device.outputGain.setValue(config.output);
      device.mono.setValue(config.mono ?? true);
      device.mix.setValue(config.mix ?? 1);
      break;
    }
    case "werkstatt":
      // ScriptCompiler.compile owns code headers and declaration boxes.
      break;
    case "autotune": {
      const device = asInstanceOf(box, boxes.AutotuneDeviceBox);
      device.key.setValue(optionIndex(config.key, AUTOTUNE_KEYS));
      let { scale } = config;
      if (scale === "pentatonicMajor") {
        scale = "majorPentatonic";
      } else if (scale === "pentatonicMinor") {
        scale = "minorPentatonic";
      }
      device.scale.setValue(optionIndex(scale, AUTOTUNE_SCALES));
      device.amount.setValue(config.amount);
      device.retune.setValue(config.retuneAmount ?? config.retune / 80);
      device.shift.setValue(config.shift);
      device.smooth.setValue(config.smooth ?? config.smoothing);
      break;
    }
    case "fxComposite":
    case "stereoSplit":
    case "frequencySplit": {
      const device = context.project.boxAdapters.adapterFor(
        box,
        context.adapters.AudioCompositeAdapter
      ).box;
      device.dry.setValue(Number.NEGATIVE_INFINITY);
      device.wet.setValue(0);
      if (config.type === "frequencySplit") {
        const split = asInstanceOf(box, boxes.FrequencySplitBox);
        split.crossover1.setValue(config.crossoverFrequencies[0] ?? 200);
        split.crossover2.setValue(config.crossoverFrequencies[1] ?? 20_000);
        split.crossover3.setValue(config.crossoverFrequencies[2] ?? 20_000);
      }
      break;
    }
    default:
      throw new Error(`Unsupported official openDAW effect: ${config.type}`);
  }
}

function insert(
  context: CreateContext,
  host: OfficialEffectHost,
  factory: keyof typeof context.core.EffectFactories.AudioNamed,
  index = Number.MAX_SAFE_INTEGER
): EffectBox {
  return context.project.api.insertEffect(
    host,
    context.core.EffectFactories.AudioNamed[factory],
    index
  );
}

function createTrim(
  context: CreateContext,
  host: OfficialEffectHost,
  gain: number,
  label: string
): StereoToolDeviceBox {
  const trim = asInstanceOf(
    insert(context, host, "StereoTool"),
    context.boxes.StereoToolDeviceBox
  );
  trim.label.setValue(label);
  trim.volume.setValue(gainToDb(gain));
  return trim;
}

function createCell(
  context: CreateContext,
  composite: AudioEffectCompositeBox,
  chain: EffectChainConfig
): AudioEffectCompositeCellBox {
  return context.boxes.AudioEffectCompositeCellBox.create(
    context.project.boxGraph,
    UUID.generate(),
    (box) => {
      box.composite.refer(composite.entries);
      writeCell(box, chain);
    }
  );
}

function writeCell(
  cell: AudioEffectCompositeCellBox,
  chain: EffectChainConfig
): void {
  cell.index.setValue(chain.order);
  cell.label.setValue(chain.name);
  cell.gain.setValue(gainToDb(chain.gain));
  cell.pan.setValue(chain.pan);
  cell.mute.setValue(chain.muted);
  cell.solo.setValue(chain.solo);
}

function officialEffectBoxes(group: OfficialEffectGroup): EffectBox[] {
  return [
    group.signalTrim,
    group.wrapper ?? group.device,
    group.outputTrim,
  ].filter((box): box is EffectBox => box !== null);
}

export function moveOfficialEffectGroup(
  context: CreateContext,
  group: OfficialEffectGroup,
  host: OfficialEffectHost,
  index: number
): number {
  const boxes = officialEffectBoxes(group);
  if (
    boxes.some(
      (box, offset) =>
        !box.host.targetVertex.contains(host) ||
        box.index.getValue() !== index + offset
    )
  ) {
    // moveEffects sorts its selection by the current index; preserve Radio's trim/device/trim order.
    boxes.forEach((box, offset) => {
      box.index.setValue(index + offset);
    });
    context.project.api.moveEffects(host, boxes, index);
  }
  return boxes.length;
}

function updateLayout(
  context: CreateContext,
  group: OfficialEffectGroup,
  config: EffectConfig,
  host: OfficialEffectHost
): void {
  if (config.signalGain === undefined) {
    group.signalTrim?.delete();
    group.signalTrim = null;
  } else if (!group.signalTrim) {
    group.signalTrim = createTrim(
      context,
      host,
      config.signalGain,
      "Cable trim"
    );
  }
  if (usesDirectEffectLayout(config)) {
    if (group.wrapper) {
      context.project.api.moveEffects(
        host,
        [group.device],
        Number.MAX_SAFE_INTEGER
      );
      group.wrapper.delete();
      group.outputTrim?.delete();
      group.wrapper = null;
      group.inputTrim = null;
      group.outputTrim = null;
    }
  } else if (!group.wrapper) {
    const { wrapper, wet, inputTrim, outputTrim } = createWrapper(
      context,
      config,
      host
    );
    context.project.api.moveEffects(wet.audioEffects, [group.device], 1);
    group.wrapper = wrapper;
    group.inputTrim = inputTrim;
    group.outputTrim = outputTrim;
  }
}

function createWrapper(
  context: CreateContext,
  config: EffectConfig,
  host: OfficialEffectHost
) {
  const wrapper = asInstanceOf(
    insert(context, host, "AudioEffectComposite"),
    context.boxes.AudioEffectCompositeBox
  );
  wrapper.label.setValue(`Radio wrapper: ${config.type}`);
  const wet = createCell(context, wrapper, {
    effects: [],
    gain: 1,
    id: `${config.id}:wet`,
    muted: false,
    name: "Wet",
    order: 0,
    pan: 0,
    solo: false,
  });
  const inputTrim = createTrim(
    context,
    wet.audioEffects,
    config.inputGain,
    "Input trim"
  );
  const outputTrim = createTrim(
    context,
    host,
    outputGain(config),
    "Output trim"
  );
  return { inputTrim, outputTrim, wet, wrapper };
}

export function createOfficialEffectGroup(
  context: CreateContext,
  config: EffectConfig,
  host: OfficialEffectHost,
  index: number
): OfficialEffectGroup {
  if (!isOfficialOpenDawEffect(config)) {
    throw new Error(`Radio-only effect cannot use openDAW: ${config.type}`);
  }
  const layout = usesDirectEffectLayout(config)
    ? null
    : createWrapper(context, config, host);
  const device = insert(
    context,
    layout?.wet.audioEffects ?? host,
    OPENDAW_FACTORY_KEYS[config.type]
  );
  const group: OfficialEffectGroup = {
    cells: new Map(),
    children: [],
    config,
    device,
    inputTrim: layout?.inputTrim ?? null,
    model: null,
    outputTrim: layout?.outputTrim ?? null,
    signalTrim: null,
    wrapper: layout?.wrapper ?? null,
  };
  const modelData =
    config.type === "neuralAmp"
      ? (config.modelData ?? getCachedNamModel(config.modelId))
      : null;
  if (config.type === "neuralAmp" && modelData) {
    group.model = context.boxes.NeuralAmpModelBox.create(
      context.project.boxGraph,
      UUID.generate(),
      (box) => {
        box.label.setValue(config.modelName ?? config.modelId ?? "Local model");
        box.model.setValue(modelData);
      }
    );
    asInstanceOf(device, context.boxes.NeuralAmpDeviceBox).model.refer(
      group.model
    );
  }
  updateOfficialEffectGroup(context, group, config, host);
  moveOfficialEffectGroup(context, group, host, index);
  return group;
}

export function updateOfficialEffectGroup(
  context: CreateContext,
  group: OfficialEffectGroup,
  config: EffectConfig,
  host: OfficialEffectHost
): void {
  updateLayout(context, group, config, host);
  writeOfficialEffectFields(context, group, config);
  group.config = config;
}

export function writeOfficialEffectFields(
  context: CreateContext,
  group: OfficialEffectGroup,
  config: EffectConfig
): void {
  group.signalTrim?.volume.setValue(gainToDb(config.signalGain ?? 1));
  group.signalTrim?.enabled.setValue(config.enabled);
  if (group.wrapper) {
    group.wrapper.enabled.setValue(config.enabled);
    group.wrapper.dry.setValue(gainToDb(1 - config.dryWet));
    group.wrapper.wet.setValue(gainToDb(config.dryWet));
    group.inputTrim?.volume.setValue(gainToDb(config.inputGain));
    group.outputTrim?.volume.setValue(gainToDb(outputGain(config)));
    group.outputTrim?.enabled.setValue(config.enabled);
  }
  configureDevice(context, group.device, config, context.bpm);
  if ("chains" in config) {
    for (const chain of config.chains) {
      const cell = group.cells.get(chain.id);
      if (cell) {
        writeCell(cell, chain);
      }
    }
  }
}

export function syncOfficialEffectCells(
  context: CreateContext,
  group: OfficialEffectGroup
): AudioEffectCompositeCellBox[] {
  const { config } = group;
  if (!("chains" in config)) {
    return [];
  }
  const composite = context.project.boxAdapters.adapterFor(
    group.device,
    context.adapters.AudioCompositeAdapter
  );
  const fixed = composite.entries.adapters().map((entry) => entry.box);
  const nextCells = new Map<string, AudioEffectCompositeCellBox>();
  for (const [index, chain] of config.chains
    .slice()
    .sort((left, right) => left.order - right.order)
    .entries()) {
    const cell =
      config.type === "fxComposite"
        ? (group.cells.get(chain.id) ??
          createCell(
            context,
            asInstanceOf(group.device, context.boxes.AudioEffectCompositeBox),
            chain
          ))
        : fixed[index];
    if (!cell) {
      continue;
    }
    writeCell(cell, chain);
    nextCells.set(chain.id, cell);
  }
  if (config.type === "frequencySplit") {
    const used = new Set(nextCells.values());
    for (const cell of fixed) {
      if (!used.has(cell)) {
        cell.mute.setValue(true);
      }
    }
  }
  const obsolete =
    config.type === "fxComposite"
      ? [...group.cells.values()].filter(
          (cell) => ![...nextCells.values()].includes(cell)
        )
      : [];
  group.cells = nextCells;
  return obsolete;
}

export function restoreWerkstattParameterValues(
  context: CreateContext,
  group: OfficialEffectGroup,
  values: Readonly<Record<string, number>>
): void {
  const device = asInstanceOf(group.device, context.boxes.WerkstattDeviceBox);
  for (const pointer of device.parameters.pointerHub.filter()) {
    const parameter = asInstanceOf(
      pointer.box,
      context.boxes.WerkstattParameterBox
    );
    const value = values[parameter.label.getValue()];
    if (typeof value === "number" && Number.isFinite(value)) {
      parameter.value.setValue(value);
    }
  }
}

export function deleteOfficialEffectGroups(
  groups: readonly OfficialEffectGroup[]
): void {
  for (const group of [...groups].reverse()) {
    for (const box of officialEffectBoxes(group).reverse()) {
      box.delete();
    }
    group.model?.delete();
  }
}

export function bindOfficialSidechain(
  context: CreateContext,
  group: OfficialEffectGroup,
  target: AudioUnitBox | null
): void {
  const { device } = group;
  if (
    !(
      device instanceof context.boxes.CompressorDeviceBox ||
      device instanceof context.boxes.GateDeviceBox ||
      device instanceof context.boxes.VocoderDeviceBox
    )
  ) {
    return;
  }
  if (target === null) {
    device.sideChain.defer();
  } else {
    device.sideChain.refer(target);
  }
}

export function createMasterRack(
  context: CreateContext,
  host: OfficialEffectHost
): {
  root: AudioEffectCompositeBox;
  dry: AudioEffectCompositeCellBox;
  wet: AudioEffectCompositeCellBox;
} {
  const root = asInstanceOf(
    insert(context, host, "AudioEffectComposite", 0),
    context.boxes.AudioEffectCompositeBox
  );
  root.label.setValue("Radio Effects");
  root.dry.setValue(Number.NEGATIVE_INFINITY);
  root.wet.setValue(0);
  const dry = createCell(context, root, {
    effects: [],
    gain: 0,
    id: "master-dry",
    muted: false,
    name: "Dry",
    order: 0,
    pan: 0,
    solo: false,
  });
  const wet = createCell(context, root, {
    effects: [],
    gain: 1,
    id: "master-wet",
    muted: false,
    name: "Wet",
    order: 1,
    pan: 0,
    solo: false,
  });
  return { dry, root, wet };
}

export function setMasterRackDryWet(
  rack: { dry: AudioEffectCompositeCellBox; wet: AudioEffectCompositeCellBox },
  value: number
): void {
  const wet = Math.max(0, Math.min(1, value));
  rack.dry.gain.setValue(gainToDb(1 - wet));
  rack.wet.gain.setValue(gainToDb(wet));
}
