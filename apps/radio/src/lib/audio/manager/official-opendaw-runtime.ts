import { AppError, captureError } from "@avoid.quest/error";
import { Editing, UUID } from "@opendaw/lib-std";
import type { Project, ProjectEnv } from "@opendaw/studio-core";
import { clampEffectTempo } from "../dsp/effects/tempo.js";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  clearWerkstattRuntimeStatus,
  setWerkstattRuntimeStatus,
} from "../dsp/effects/werkstatt-runtime-status.js";
import type {
  EffectsGraphRuntime,
  EffectsPerformanceSnapshot,
  OfficialSoundSettings,
} from "./effects-graph-runtime.js";
import {
  bindOfficialSidechain,
  createMasterRack,
  createOfficialEffectGroup,
  deleteOfficialEffectGroups,
  type OfficialEffectGroup,
  restoreWerkstattParameterValues,
  setMasterRackDryWet,
  updateOfficialEffectGroup,
  usesDirectOfficialEffectLayout,
} from "./official-opendaw-effect-adapter.js";
import { ensureOpenDawAudioWorklets } from "./opendaw-audio-worklets.js";

const MAX_MONITORING_CHANNELS = 8;

export const DEFAULT_OPENDAW_RUNTIME_URLS = {
  offlineWorkerUrl: "/opendaw/wasm-offline-worker.js",
  processorUrl: "/opendaw/processors.js",
  wasmProcessorUrl: "/opendaw/wasm-processor.js",
  wasmUrl: "/opendaw",
} as const;

export type OpenDawRuntimeUrls = {
  processorUrl: string;
  wasmProcessorUrl: string;
  offlineWorkerUrl: string;
  wasmUrl: string;
};

type RuntimeModules = {
  adapters: typeof import("@opendaw/studio-adapters");
  boxes: typeof import("@opendaw/studio-boxes");
  core: typeof import("@opendaw/studio-core");
  wasm: typeof import("@opendaw/studio-core-wasm");
};

type RuntimeModuleLoader = () => Promise<RuntimeModules>;
type WerkstattCompiler = ReturnType<
  typeof import("@opendaw/studio-adapters").ScriptCompiler.create
>;
type Terminable = { terminate: () => void };

type SoundUnit = ReturnType<Project["api"]["createAnyInstrument"]> & {
  effects: EffectConfig[];
  groups: OfficialEffectGroup[];
  inputChannels: 1 | 2;
  monitoring: boolean;
  rack: ReturnType<typeof createMasterRack>;
  source: AudioNode | null;
  destination: AudioNode | null;
};

const loadRuntimeModules: RuntimeModuleLoader = async () => {
  const [adapters, boxes, core, wasm] = await Promise.all([
    import("@opendaw/studio-adapters"),
    import("@opendaw/studio-boxes"),
    import("@opendaw/studio-core"),
    import("@opendaw/studio-core-wasm"),
  ]);
  return { adapters, boxes, core, wasm };
};

function unavailableAssetManager(): ProjectEnv["sampleManager"] {
  const unavailable = (): never => {
    throw new Error(
      "Sample loading is unavailable in the live-radio openDAW runtime"
    );
  };
  return {
    getOrCreate: unavailable,
    invalidate: () => undefined,
    record: () => undefined,
    register: unavailable,
    remove: () => undefined,
  };
}

function unavailableSoundfontManager(): ProjectEnv["soundfontManager"] {
  return {
    getOrCreate: () => {
      throw new Error(
        "Soundfont loading is unavailable in the live-radio openDAW runtime"
      );
    },
    invalidate: () => undefined,
    remove: () => undefined,
  };
}

/**
 * Owns one client-side openDAW Project/Engine and one Tape AudioUnit for every
 * live radio sound. Audio enters and leaves through openDAW's monitoring
 * output, so no server processing or clip conversion is involved.
 *
 * This class is deliberately loaded through dynamic imports: merely importing
 * AudioManager during SSR must not evaluate browser-only openDAW modules.
 */
export class OfficialOpenDawRuntime implements EffectsGraphRuntime {
  private readonly context: AudioContext;
  private readonly urls: OpenDawRuntimeUrls;
  private readonly moduleLoader: RuntimeModuleLoader;
  private readonly sidechainTargets = new Map<string, string>();
  private readonly soundUnits = new Map<string, SoundUnit>();
  private readonly connectionGenerations = new Map<string, number>();
  private readonly werkstattGenerations = new Map<
    OfficialEffectGroup,
    number
  >();
  private readonly werkstattGroups = new Map<string, OfficialEffectGroup>();
  private readonly werkstattSubscriptions = new Map<
    OfficialEffectGroup,
    Terminable
  >();
  private initializePromise: Promise<void> | null = null;
  private project: Project | null = null;
  private modules: RuntimeModules | null = null;
  private werkstattCompiler: WerkstattCompiler | null = null;
  private silentDestination: GainNode | null = null;
  private nextWerkstattGeneration = 0;
  private bpm = 120;
  private closed = false as boolean;

  constructor(
    context: AudioContext,
    urls: OpenDawRuntimeUrls = DEFAULT_OPENDAW_RUNTIME_URLS,
    moduleLoader: RuntimeModuleLoader = loadRuntimeModules
  ) {
    this.context = context;
    this.urls = urls;
    this.moduleLoader = moduleLoader;
  }

  get isReady(): boolean {
    return this.project !== null;
  }

  get soundCount(): number {
    return this.soundUnits.size;
  }

  getPerformanceSnapshot(): EffectsPerformanceSnapshot | null {
    const { project } = this;
    if (!project) {
      return null;
    }
    return {
      backend: "official",
      monitoringChannelCount: [...this.soundUnits.values()].reduce(
        (total, unit) =>
          unit.source === null ? total : total + unit.inputChannels,
        0
      ),
      soundCount: this.soundUnits.size,
      workletCount: 1,
    };
  }

  async initialize(): Promise<void> {
    if (this.closed) {
      throw new Error("openDAW runtime has been closed");
    }
    if (this.isReady) {
      return;
    }
    this.initializePromise ??= this.initializeEngine();
    try {
      await this.initializePromise;
    } catch (error) {
      this.initializePromise = null;
      throw error;
    }
  }

  private async initializeEngine(): Promise<void> {
    if (
      typeof AudioWorkletNode === "undefined" ||
      typeof SharedArrayBuffer === "undefined"
    ) {
      throw new Error(
        "openDAW requires AudioWorklet and cross-origin-isolated SharedArrayBuffer support"
      );
    }

    const modules = await this.moduleLoader();
    const {
      AudioWorklets,
      Project: OpenDawProject,
      SampleService,
    } = modules.core;

    modules.wasm.WasmEngine.install({
      offlineWorkerUrl: this.urls.offlineWorkerUrl,
      processorUrl: this.urls.wasmProcessorUrl,
      wasmUrl: this.urls.wasmUrl,
    });

    const [audioWorklets, wasmReady] = await Promise.all([
      ensureOpenDawAudioWorklets(
        this.context,
        AudioWorklets,
        this.urls.processorUrl
      ),
      modules.wasm.WasmEngine.ensureReady(this.context),
    ]);
    if (!wasmReady) {
      throw new Error("openDAW WASM engine assets failed to load");
    }

    const env = {
      audioContext: this.context,
      audioWorklets,
      sampleManager: unavailableAssetManager(),
      sampleService: new SampleService(
        this.context,
        modules.adapters.BpmDetector.Unknown
      ),
      soundfontManager: unavailableSoundfontManager(),
      soundfontService: undefined as unknown as ProjectEnv["soundfontService"],
    };
    // Live monitoring does not use openDAW's editor user or output maximizer.
    const project = OpenDawProject.fromSkeleton(
      env,
      modules.adapters.ProjectSkeleton.empty({
        createDefaultUser: false,
        createOutputMaximizer: false,
      }),
      false
    );
    try {
      const worklet = project.startAudioWorklet();

      // Project.startAudioWorklet connects the normal master output. Live radio
      // uses only the per-source monitor returns; leaving output 0 connected
      // would duplicate the signal.
      worklet.disconnect(this.context.destination, 0, 0);
      await project.engine.isReady();

      if (this.closed) {
        throw new Error("openDAW runtime initialization was canceled");
      }

      this.werkstattCompiler = modules.adapters.ScriptCompiler.create({
        functionName: "werkstatt",
        headerTag: "werkstatt",
        registryName: "werkstattProcessors",
      });
      this.modules = modules;
      this.project = project;
      worklet.addEventListener(
        "processorerror",
        () => {
          if (this.project === project && !this.closed) {
            captureError(
              new AppError({
                category: "playback",
                code: "AUDIO_PROCESSOR_FAILED",
                context: { backend: "official" },
                safeMessage: "Audio worklet processor stopped",
              }),
              { operation: "runAudioProcessor", surface: "ui" }
            );
          }
        },
        { once: true }
      );
    } catch (error) {
      project.terminate();
      throw error;
    }
  }

  async connectSound(
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    generation = (this.connectionGenerations.get(soundId) ?? 0) + 1,
    inputChannels: 1 | 2 = 2,
    settings?: OfficialSoundSettings
  ): Promise<boolean> {
    if (!this.beginSoundConnection(soundId, generation)) {
      return false;
    }
    if (
      source.context !== this.context ||
      destination.context !== this.context
    ) {
      throw new Error("openDAW monitoring nodes must share one AudioContext");
    }
    await this.initialize();
    if (!this.isCurrentSoundConnection(soundId, generation)) {
      return false;
    }
    const existing = this.soundUnits.has(soundId);
    try {
      return this.transaction(() => {
        const connected = this.connectSoundUnit(
          soundId,
          source,
          destination,
          true,
          generation,
          inputChannels
        );
        if (connected && settings) {
          this.setTempo(settings.tempo);
          this.setSidechainTarget(soundId, settings.sidechainSoundId);
          this.syncEffects(soundId, settings.effects);
          this.setDryWet(soundId, settings.dryWet);
        }
        return connected;
      });
    } catch (error) {
      const unit = this.soundUnits.get(soundId);
      if (!existing && unit) {
        this.soundUnits.delete(soundId);
        this.sidechainTargets.delete(soundId);
        this.releaseWerkstattGroups(unit.groups);
        this.requireProject().engine.unregisterMonitoringSource(
          unit.audioUnitBox.address.uuid
        );
      }
      throw error;
    }
  }

  async connectSidechainSource(
    soundId: string,
    source: AudioNode,
    generation = (this.connectionGenerations.get(soundId) ?? 0) + 1,
    inputChannels: 1 | 2 = 2
  ): Promise<boolean> {
    if (!this.beginSoundConnection(soundId, generation)) {
      return false;
    }
    if (source.context !== this.context) {
      throw new Error("openDAW monitoring nodes must share one AudioContext");
    }
    await this.initialize();
    if (!this.isCurrentSoundConnection(soundId, generation)) {
      return false;
    }
    const existing = this.soundUnits.get(soundId);
    if (
      existing &&
      !existing.monitoring &&
      existing.source === source &&
      existing.inputChannels === inputChannels
    ) {
      this.rebindSidechains();
      return true;
    }
    return this.connectSoundUnit(
      soundId,
      source,
      this.getSilentDestination(),
      false,
      generation,
      inputChannels
    );
  }

  private connectSoundUnit(
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    monitoring: boolean,
    generation: number,
    inputChannels: 1 | 2
  ): boolean {
    if (!this.isCurrentSoundConnection(soundId, generation)) {
      return false;
    }
    const project = this.requireProject();
    let unit = this.soundUnits.get(soundId);
    const occupiedChannels = [...this.soundUnits.entries()].reduce(
      (total, [id, candidate]) =>
        id === soundId || candidate.source === null
          ? total
          : total + candidate.inputChannels,
      0
    );
    if (occupiedChannels + inputChannels > MAX_MONITORING_CHANNELS) {
      throw new Error(
        `openDAW monitoring supports at most ${MAX_MONITORING_CHANNELS} input channels`
      );
    }

    if (!unit) {
      const product = this.transaction(() => {
        const created = project.api.createInstrument(
          this.requireModules().adapters.InstrumentFactories.Tape,
          { name: `Radio ${this.soundUnits.size + 1}` }
        );
        const rack = createMasterRack(
          this.adapterContext(),
          created.audioUnitBox.audioEffects
        );
        return { ...created, rack };
      });
      unit = {
        ...product,
        destination: null,
        effects: [],
        groups: [],
        inputChannels,
        monitoring,
        source: null,
      };
      this.soundUnits.set(soundId, unit);
    } else if (
      unit.source === source &&
      unit.destination === destination &&
      unit.monitoring === monitoring &&
      unit.inputChannels === inputChannels
    ) {
      this.rebindSidechains();
      return true;
    } else if (unit.source !== null) {
      project.engine.unregisterMonitoringSource(unit.audioUnitBox.address.uuid);
    }

    project.engine.registerMonitoringSource(
      unit.audioUnitBox.address.uuid,
      source,
      inputChannels,
      destination
    );
    unit.source = source;
    unit.destination = destination;
    unit.inputChannels = inputChannels;
    unit.monitoring = monitoring;
    this.rebindSidechains();
    return true;
  }

  disconnectSound(
    soundId: string,
    generation = (this.connectionGenerations.get(soundId) ?? 0) + 1
  ): void {
    const current = this.connectionGenerations.get(soundId) ?? 0;
    if (generation < current) {
      return;
    }
    this.connectionGenerations.set(soundId, Math.max(generation, current + 1));
    this.disconnectSoundUnit(soundId);
  }

  private disconnectSoundUnit(soundId: string): void {
    const unit = this.soundUnits.get(soundId);
    const { project } = this;
    if (!(unit && project && unit.source)) {
      return;
    }
    project.engine.unregisterMonitoringSource(unit.audioUnitBox.address.uuid);
    unit.source = null;
    unit.destination = null;
    this.rebindSidechains();
  }

  deleteSound(
    soundId: string,
    generation = (this.connectionGenerations.get(soundId) ?? 0) + 1
  ): void {
    const current = this.connectionGenerations.get(soundId) ?? 0;
    if (generation < current) {
      return;
    }
    this.connectionGenerations.set(soundId, Math.max(generation, current + 1));
    const unit = this.soundUnits.get(soundId);
    if (!unit) {
      return;
    }
    this.disconnectSoundUnit(soundId);
    const { project } = this;
    if (project) {
      this.releaseWerkstattGroups(unit.groups);
      this.transaction(() => project.api.deleteAudioUnit(unit.audioUnitBox));
    }
    this.soundUnits.delete(soundId);
    this.sidechainTargets.delete(soundId);
    this.rebindSidechains();
  }

  syncEffects(soundId: string, effects: readonly EffectConfig[]): void {
    const unit = this.soundUnits.get(soundId);
    const { project } = this;
    if (!(unit && project)) {
      return;
    }
    const nextEffects = effects
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((effect) => structuredClone(effect));
    const previousEffects = unit.effects;
    const stableUpdates = stableEffectUpdates(previousEffects, nextEffects);
    if (stableUpdates !== null) {
      const groupsById = new Map(
        flattenGroups(unit.groups).map((group) => [group.config.id, group])
      );
      this.transaction(() => {
        for (const { after, before } of stableUpdates) {
          const group = groupsById.get(after.id);
          if (group) {
            updateOfficialEffectGroup(group, after, this.bpm);
            if (
              after.type === "werkstatt" &&
              before.type === "werkstatt" &&
              werkstattSource(before) === werkstattSource(after)
            ) {
              restoreWerkstattParameterValues(group, after.parameters);
            }
          }
        }
        unit.effects = nextEffects;
        this.bindSidechains();
      });
      for (const { after, before } of stableUpdates) {
        const group = groupsById.get(after.id);
        if (
          group &&
          after.type === "werkstatt" &&
          before.type === "werkstatt" &&
          werkstattSource(before) !== werkstattSource(after)
        ) {
          this.compileWerkstattGroup(group, after);
        }
      }
      return;
    }

    this.releaseWerkstattGroups(unit.groups);
    this.transaction(() => {
      deleteOfficialEffectGroups(unit.groups);
      unit.effects = nextEffects;
      unit.groups = unit.effects.map((effect, index) =>
        createOfficialEffectGroup(
          this.adapterContext(),
          effect,
          unit.rack.wet.audioEffects,
          index * 3
        )
      );
      this.bindSidechains();
    });
    for (const group of flattenGroups(unit.groups)) {
      if (group.config.type === "werkstatt") {
        this.compileWerkstattGroup(group, group.config);
      }
    }
  }

  setSidechainTarget(soundId: string, targetSoundId: string | null): void {
    if (targetSoundId === null) {
      this.sidechainTargets.delete(soundId);
    } else {
      this.sidechainTargets.set(soundId, targetSoundId);
    }
    this.rebindSidechains();
  }

  setDryWet(soundId: string, value: number): void {
    const unit = this.soundUnits.get(soundId);
    const { project } = this;
    if (!(unit && project)) {
      return;
    }
    this.transaction(() => setMasterRackDryWet(unit.rack, value));
  }

  setTempo(bpm: number): void {
    const { project } = this;
    if (!project) {
      return;
    }
    this.bpm = clampEffectTempo(bpm);
    this.transaction(() => project.api.setBpm(this.bpm));
  }

  cleanup(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const soundId of this.soundUnits.keys()) {
      this.disconnectSoundUnit(soundId);
    }
    this.soundUnits.clear();
    this.sidechainTargets.clear();
    this.connectionGenerations.clear();
    for (const subscription of this.werkstattSubscriptions.values()) {
      subscription.terminate();
    }
    for (const effectId of this.werkstattGroups.keys()) {
      clearWerkstattRuntimeStatus(effectId);
    }
    this.werkstattSubscriptions.clear();
    this.werkstattGenerations.clear();
    this.werkstattGroups.clear();
    this.silentDestination?.disconnect();
    this.silentDestination = null;
    this.project?.terminate();
    this.project = null;
    this.modules = null;
    this.werkstattCompiler = null;
    this.initializePromise = null;
  }

  private transaction<T>(write: () => T): T {
    const graph = this.requireProject().boxGraph;
    if (graph.inTransaction()) {
      return write();
    }
    graph.beginTransaction();
    try {
      const result = write();
      graph.endTransaction();
      return result;
    } catch (error) {
      if (graph.inTransaction()) {
        graph.abortTransaction();
      }
      throw error;
    }
  }

  private requireModules(): RuntimeModules {
    if (!this.modules) {
      throw new Error("openDAW runtime is not initialized");
    }
    return this.modules;
  }

  private requireProject(): Project {
    if (!this.project) {
      throw new Error("openDAW runtime is not initialized");
    }
    return this.project;
  }

  private adapterContext() {
    const modules = this.requireModules();
    return {
      boxes: modules.boxes,
      bpm: this.bpm,
      core: modules.core,
      project: this.requireProject(),
    };
  }

  private beginSoundConnection(soundId: string, generation: number): boolean {
    const current = this.connectionGenerations.get(soundId) ?? 0;
    if (generation < current) {
      return false;
    }
    this.connectionGenerations.set(soundId, generation);
    return true;
  }

  private isCurrentSoundConnection(
    soundId: string,
    generation: number
  ): boolean {
    return (
      !this.closed && this.connectionGenerations.get(soundId) === generation
    );
  }

  private getSilentDestination(): GainNode {
    if (!this.silentDestination) {
      this.silentDestination = this.context.createGain();
      this.silentDestination.gain.value = 0;
      this.silentDestination.connect(this.context.destination);
    }
    return this.silentDestination;
  }

  private compileWerkstattGroup(
    group: OfficialEffectGroup,
    config: Extract<EffectConfig, { type: "werkstatt" }>
  ): void {
    const compiler = this.werkstattCompiler;
    const { project } = this;
    if (!(compiler && project)) {
      return;
    }
    this.subscribeWerkstattMessages(group, config.id);
    this.nextWerkstattGeneration += 1;
    const generation = this.nextWerkstattGeneration;
    this.werkstattGenerations.set(group, generation);
    this.werkstattGroups.set(config.id, group);
    setWerkstattRuntimeStatus(config.id, {
      message: "Compiling locally in the openDAW audio worklet…",
      state: "compiling",
    });
    this.transaction(() =>
      compiler.compile(
        this.context,
        Editing.Transient,
        group.device as never,
        config.code ?? config.source
      )
    )
      .then(() => {
        if (!this.isCurrentWerkstattCompile(group, config.id, generation)) {
          return;
        }
        this.transaction(() =>
          restoreWerkstattParameterValues(group, config.parameters)
        );
        setWerkstattRuntimeStatus(config.id, {
          message: "Compiled and running in the client-side audio worklet.",
          state: "ready",
        });
      })
      .catch((cause: unknown) => {
        if (!this.isCurrentWerkstattCompile(group, config.id, generation)) {
          return;
        }
        setWerkstattRuntimeStatus(config.id, {
          message:
            cause instanceof Error ? cause.message : "Compilation failed.",
          state: "error",
        });
      });
  }

  private subscribeWerkstattMessages(
    group: OfficialEffectGroup,
    effectId: string
  ): void {
    if (this.werkstattSubscriptions.has(group)) {
      return;
    }
    const device = group.device as unknown as {
      address: { uuid: Uint8Array };
    };
    const subscription = this.requireProject().engine.subscribeDeviceMessage(
      UUID.toString(device.address.uuid),
      (message) => {
        if (this.werkstattGroups.get(effectId) === group) {
          setWerkstattRuntimeStatus(effectId, {
            message,
            state: "error",
          });
        }
      }
    );
    this.werkstattSubscriptions.set(group, subscription);
  }

  private releaseWerkstattGroups(groups: readonly OfficialEffectGroup[]): void {
    for (const group of flattenGroups(groups)) {
      if (group.config.type !== "werkstatt") {
        continue;
      }
      this.werkstattSubscriptions.get(group)?.terminate();
      this.werkstattSubscriptions.delete(group);
      this.werkstattGenerations.delete(group);
      if (this.werkstattGroups.get(group.config.id) === group) {
        this.werkstattGroups.delete(group.config.id);
        clearWerkstattRuntimeStatus(group.config.id);
      }
    }
  }

  private isCurrentWerkstattCompile(
    group: OfficialEffectGroup,
    effectId: string,
    generation: number
  ): boolean {
    return (
      !this.closed &&
      this.werkstattGroups.get(effectId) === group &&
      this.werkstattGenerations.get(group) === generation
    );
  }

  private bindSidechains(): void {
    const bind = (
      group: OfficialEffectGroup,
      target: SoundUnit["audioUnitBox"] | null
    ): void => {
      bindOfficialSidechain(group, group.config.sidechain ? target : null);
      for (const child of group.children) {
        bind(child, target);
      }
    };
    for (const [soundId, unit] of this.soundUnits) {
      const targetId = this.sidechainTargets.get(soundId);
      const targetUnit = targetId ? this.soundUnits.get(targetId) : undefined;
      const target =
        targetUnit?.source === null || targetUnit === undefined
          ? null
          : targetUnit.audioUnitBox;
      for (const group of unit.groups) {
        bind(group, target);
      }
    }
  }

  private rebindSidechains(): void {
    if (this.project) {
      this.transaction(() => this.bindSidechains());
    }
  }
}

export type { RuntimeModuleLoader };

function flattenGroups(
  groups: readonly OfficialEffectGroup[]
): OfficialEffectGroup[] {
  return groups.flatMap((group) => [group, ...flattenGroups(group.children)]);
}

function stableEffectUpdates(
  previous: readonly EffectConfig[],
  next: readonly EffectConfig[]
): Array<{ before: EffectConfig; after: EffectConfig }> | null {
  if (!hasStableEffectLayout(previous, next)) {
    return null;
  }
  const previousFlat = flattenEffects(previous);
  const nextFlat = flattenEffects(next);
  const updates: Array<{
    before: EffectConfig;
    after: EffectConfig;
  }> = [];
  for (let index = 0; index < previousFlat.length; index += 1) {
    const before = previousFlat[index];
    const after = nextFlat[index];
    if (!(before && after)) {
      continue;
    }
    if (
      JSON.stringify(localEffectConfig(before)) ===
      JSON.stringify(localEffectConfig(after))
    ) {
      continue;
    }
    if (
      before.type === "neuralAmp" &&
      after.type === "neuralAmp" &&
      (before.modelId !== after.modelId || before.modelData !== after.modelData)
    ) {
      return null;
    }
    updates.push({ after, before });
  }
  return updates;
}

function hasStableEffectLayout(
  previous: readonly EffectConfig[],
  next: readonly EffectConfig[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((before, index) => {
      const after = next[index];
      if (
        !after ||
        before.id !== after.id ||
        before.type !== after.type ||
        before.order !== after.order ||
        (before.signalGain === undefined) !==
          (after.signalGain === undefined) ||
        usesDirectOfficialEffectLayout(before) !==
          usesDirectOfficialEffectLayout(after)
      ) {
        return false;
      }
      if (!("chains" in before)) {
        return !("chains" in after);
      }
      if (!("chains" in after)) {
        return false;
      }
      return (
        before.chains.length === after.chains.length &&
        before.chains.every((chain, chainIndex) => {
          const nextChain = after.chains[chainIndex];
          return (
            nextChain !== undefined &&
            chain.id === nextChain.id &&
            chain.order === nextChain.order &&
            hasStableEffectLayout(chain.effects, nextChain.effects)
          );
        })
      );
    })
  );
}

function flattenEffects(effects: readonly EffectConfig[]): EffectConfig[] {
  return effects.flatMap((effect) => [
    effect,
    ...("chains" in effect
      ? effect.chains.flatMap((chain) => flattenEffects(chain.effects))
      : []),
  ]);
}

function localEffectConfig(effect: EffectConfig): unknown {
  if (!("chains" in effect)) {
    return effect;
  }
  return {
    ...effect,
    chains: effect.chains.map(({ effects: _, ...chain }) => chain),
  };
}

function werkstattSource(
  config: Extract<EffectConfig, { type: "werkstatt" }>
): string {
  return config.code ?? config.source;
}
