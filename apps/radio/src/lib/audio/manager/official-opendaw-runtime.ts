import { AppError, captureError } from "@avoid.quest/error";
import { asInstanceOf, Editing, UUID } from "@opendaw/lib-std";
import type { EngineWorklet, Project, ProjectEnv } from "@opendaw/studio-core";
import { clampEffectTempo } from "../dsp/effects/tempo.js";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  clearWerkstattRuntimeStatus,
  getWerkstattRuntimeStatus,
  setWerkstattRuntimeStatus,
} from "../dsp/effects/werkstatt-runtime-status.js";
import {
  effectFieldsAreStructural,
  findEffectInTree,
  localEffectConfig,
  updateEffectFieldsInTree,
} from "../dsp/routing/effect-tree.js";
import type {
  EffectsGraphRuntime,
  EffectsPerformanceSnapshot,
  EffectWriteResult,
  OfficialSoundSettings,
} from "./effects-graph-runtime.js";
import {
  bindOfficialSidechain,
  createMasterRack,
  createOfficialEffectGroup,
  deleteOfficialEffectGroups,
  moveOfficialEffectGroup,
  type OfficialEffectGroup,
  type OfficialEffectHost,
  restoreWerkstattParameterValues,
  setMasterRackDryWet,
  syncOfficialEffectCells,
  updateOfficialEffectGroup,
  writeOfficialEffectFields,
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
  groupsById: Map<string, OfficialEffectGroup>;
  groups: OfficialEffectGroup[];
  inputChannels: 1 | 2;
  monitoringInput: GainNode;
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
  private readonly werkstattSources = new Map<OfficialEffectGroup, string>();
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
  private reportedWorkletFailure = false as boolean;

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
      const ready = Promise.withResolvers<void>();
      const load = (worklet: EngineWorklet): void => {
        worklet.isReady().then(ready.resolve, ready.reject);
        // Every worklet starts with master output 0 connected. Radio uses only
        // monitoring returns, including after openDAW replaces a failed worklet.
        worklet.disconnect(this.context.destination, 0, 0);
        for (const unit of this.soundUnits.values()) {
          if (unit.source && unit.destination) {
            this.registerMonitoringSource(unit, project);
          }
          for (const group of unit.groupsById.values()) {
            if (group.config.type === "werkstatt") {
              this.subscribeWerkstattMessages(group, group.config.id);
            }
          }
        }
      };
      const initialWorklet = project.startAudioWorklet({
        load,
        unload: () => {
          this.disconnectMonitoringInputs();
          if (this.project !== project || this.closed) {
            return Promise.resolve();
          }
          for (const subscription of this.werkstattSubscriptions.values()) {
            subscription.terminate();
          }
          this.werkstattSubscriptions.clear();
          // openDAW restarts indefinitely; report only once per runtime.
          if (!this.reportedWorkletFailure) {
            this.reportedWorkletFailure = true;
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
          return Promise.resolve();
        },
      });
      load(initialWorklet);
      await ready.promise;

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
        groupsById: new Map(),
        inputChannels,
        monitoring,
        monitoringInput: this.context.createGain(),
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
      this.unregisterMonitoringSource(unit);
    }

    unit.source = source;
    unit.destination = destination;
    unit.inputChannels = inputChannels;
    unit.monitoring = monitoring;
    this.registerMonitoringSource(unit);
    this.rebindSidechains();
    return true;
  }

  private disconnectMonitoringInputs(): void {
    // Register/unregister rebuild every remaining source, leaving old splitter
    // edges behind. Clear owned inputs before that rebuild or after teardown.
    for (const unit of this.soundUnits.values()) {
      unit.monitoringInput.disconnect();
    }
  }

  private registerMonitoringSource(
    unit: SoundUnit,
    project = this.requireProject()
  ): void {
    if (!(unit.source && unit.destination)) {
      return;
    }
    this.disconnectMonitoringInputs();
    unit.source.connect(unit.monitoringInput);
    project.engine.registerMonitoringSource(
      unit.audioUnitBox.address.uuid,
      unit.monitoringInput,
      unit.inputChannels,
      unit.destination
    );
  }

  private unregisterMonitoringSource(unit: SoundUnit): void {
    this.disconnectMonitoringInputs();
    unit.source?.disconnect(unit.monitoringInput);
    this.requireProject().engine.unregisterMonitoringSource(
      unit.audioUnitBox.address.uuid
    );
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
    this.unregisterMonitoringSource(unit);
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
      for (const group of unit.groupsById.values()) {
        this.releaseWerkstattGroup(group);
      }
      this.transaction(() => project.api.deleteAudioUnit(unit.audioUnitBox));
    }
    this.soundUnits.delete(soundId);
    this.sidechainTargets.delete(soundId);
    this.rebindSidechains();
  }

  syncEffects(soundId: string, effects: readonly EffectConfig[]): void {
    const unit = this.soundUnits.get(soundId);
    if (!(unit && this.project)) {
      return;
    }
    const nextEffects = structuredClone([...effects]);
    const nextGroups = new Map<string, OfficialEffectGroup>();
    const { groups, retired: retiredGroups } = this.transaction(() => {
      const obsoleteCells: ReturnType<typeof syncOfficialEffectCells> = [];
      const next = this.syncEffectChain(
        unit.groupsById,
        nextGroups,
        nextEffects,
        unit.rack.wet.audioEffects,
        obsoleteCells
      );
      const retired = [...unit.groupsById.values()].filter(
        (group) => nextGroups.get(group.config.id) !== group
      );
      deleteOfficialEffectGroups(retired);
      for (const cell of obsoleteCells) {
        cell.delete();
      }
      this.bindSidechains({ groups: next, soundId });
      return { groups: next, retired };
    });
    unit.effects = nextEffects;
    unit.groups = groups;
    unit.groupsById = nextGroups;
    this.afterCommit(() => {
      for (const group of retiredGroups) {
        this.releaseWerkstattGroup(group);
      }
      this.compileWerkstattChain(soundId);
    });
  }

  private compileWerkstattChain(
    soundId: string,
    groups: readonly OfficialEffectGroup[] = this.soundUnits.get(soundId)
      ?.groups ?? []
  ): void {
    for (const group of groups) {
      const { config } = group;
      if (!config.enabled) {
        continue;
      }
      if (config.type === "werkstatt") {
        this.compileWerkstattGroup(soundId, group, config);
      }
      this.compileWerkstattChain(soundId, group.children);
    }
  }

  writeEffect(
    soundId: string,
    effectId: string,
    config: EffectConfig
  ): EffectWriteResult {
    const unit = this.soundUnits.get(soundId);
    const group = unit?.groupsById.get(effectId);
    if (!(unit && group && this.project)) {
      return "unavailable";
    }
    if (effectFieldsAreStructural(group.config, config)) {
      return "structural";
    }
    const authored = structuredClone(config);
    this.transaction(() => {
      writeOfficialEffectFields(this.adapterContext(), group, authored);
      group.config = authored;
      syncOfficialEffectCells(this.adapterContext(), group);
      if (authored.type === "werkstatt" && authored.enabled) {
        this.compileWerkstattGroup(soundId, group, authored);
      }
    });
    unit.effects = updateEffectFieldsInTree(unit.effects, effectId, authored);
    for (const current of unit.groupsById.values()) {
      current.config =
        findEffectInTree(unit.effects, current.config.id) ?? current.config;
    }
    return "applied";
  }

  private syncEffectChain(
    previous: ReadonlyMap<string, OfficialEffectGroup>,
    next: Map<string, OfficialEffectGroup>,
    effects: readonly EffectConfig[],
    host: OfficialEffectHost,
    obsoleteCells: ReturnType<typeof syncOfficialEffectCells>
  ): OfficialEffectGroup[] {
    const context = this.adapterContext();
    let index = 0;
    return effects
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((config) => {
        const existing = previous.get(config.id);
        const before = existing?.config;
        const group =
          existing && canKeepDevice(existing.config, config)
            ? existing
            : createOfficialEffectGroup(context, config, host, index);
        const changed =
          !before ||
          JSON.stringify(localEffectConfig(before)) !==
            JSON.stringify(localEffectConfig(config));
        if (group === existing && changed) {
          updateOfficialEffectGroup(context, group, config, host);
        } else {
          group.config = config;
        }
        next.set(config.id, group);
        index += moveOfficialEffectGroup(context, group, host, index);
        obsoleteCells.push(...syncOfficialEffectCells(context, group));
        group.children =
          "chains" in config
            ? config.chains.flatMap((chain) => {
                const cell = group.cells.get(chain.id);
                return cell
                  ? this.syncEffectChain(
                      previous,
                      next,
                      chain.effects,
                      cell.audioEffects,
                      obsoleteCells
                    )
                  : [];
              })
            : [];
        return group;
      });
  }

  setSidechainTarget(soundId: string, targetSoundId: string | null): void {
    this.transaction(() => {
      if (targetSoundId === null) {
        this.sidechainTargets.delete(soundId);
      } else {
        this.sidechainTargets.set(soundId, targetSoundId);
      }
      this.bindSidechains();
    });
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
    this.transaction(() => {
      this.bpm = clampEffectTempo(bpm);
      project.api.setBpm(this.bpm);
    });
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
    this.werkstattSources.clear();
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
    const { bpm } = this;
    const targets = new Map(this.sidechainTargets);
    const units = new Map(
      [...this.soundUnits].map(([id, unit]) => [id, { ...unit }])
    );
    const groups = new Map(
      [...this.soundUnits.values()].flatMap((unit) =>
        [...unit.groupsById.values()].map(
          (group) => [group, { ...group }] as const
        )
      )
    );
    graph.beginTransaction();
    try {
      const result = write();
      graph.endTransaction();
      return result;
    } catch (error) {
      if (graph.inTransaction()) {
        graph.abortTransaction();
      }
      this.bpm = bpm;
      this.sidechainTargets.clear();
      for (const [id, target] of targets) {
        this.sidechainTargets.set(id, target);
      }
      this.restoreMonitoringSources(units);
      for (const [group, previous] of groups) {
        Object.assign(group, restoreGroup(previous, graph));
      }
      this.soundUnits.clear();
      for (const [id, unit] of units) {
        this.soundUnits.set(id, unit);
      }
      throw error;
    }
  }

  private restoreMonitoringSources(
    units: ReadonlyMap<string, SoundUnit>
  ): void {
    for (const [id, unit] of this.soundUnits) {
      const previous = units.get(id);
      if (
        !previous ||
        previous.source !== unit.source ||
        previous.destination !== unit.destination ||
        previous.inputChannels !== unit.inputChannels
      ) {
        this.unregisterMonitoringSource(unit);
        if (previous?.source && previous.destination) {
          this.registerMonitoringSource(previous);
        }
      }
    }
  }

  private afterCommit(commit: () => void): void {
    const graph = this.requireProject().boxGraph;
    if (!graph.inTransaction()) {
      commit();
      return;
    }
    const subscription = graph.subscribeTransaction({
      onBeginTransaction: () => undefined,
      onEndTransaction: (aborted) => {
        subscription.terminate();
        if (!aborted) {
          commit();
        }
      },
    });
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
      adapters: modules.adapters,
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
    soundId: string,
    group: OfficialEffectGroup,
    config: Extract<EffectConfig, { type: "werkstatt" }>
  ): void {
    const compiler = this.werkstattCompiler;
    const { project } = this;
    if (!(compiler && project)) {
      return;
    }
    const device = asInstanceOf(
      group.device,
      this.requireModules().boxes.WerkstattDeviceBox
    );
    const source = compiler.stripHeader(werkstattSource(config));
    if (this.werkstattSources.get(group) === source) {
      if (getWerkstattRuntimeStatus(config.id).state === "ready") {
        this.transaction(() =>
          restoreWerkstattParameterValues(
            this.adapterContext(),
            group,
            config.parameters
          )
        );
      }
      return;
    }
    if (project.boxGraph.inTransaction()) {
      this.afterCommit(() => this.compileWerkstattChain(soundId));
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
    this.werkstattSources.set(group, source);
    this.transaction(() =>
      compiler.compile(this.context, Editing.Transient, device, source)
    )
      .then(() => {
        if (!this.isCurrentWerkstattCompile(group, config.id, generation)) {
          return;
        }
        const current = group.config;
        if (current.type === "werkstatt") {
          this.transaction(() =>
            restoreWerkstattParameterValues(
              this.adapterContext(),
              group,
              current.parameters
            )
          );
        }
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
    const { device } = group;
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

  private releaseWerkstattGroup(group: OfficialEffectGroup): void {
    if (group.config.type !== "werkstatt") {
      return;
    }
    this.werkstattSubscriptions.get(group)?.terminate();
    this.werkstattSubscriptions.delete(group);
    this.werkstattGenerations.delete(group);
    this.werkstattSources.delete(group);
    if (this.werkstattGroups.get(group.config.id) === group) {
      this.werkstattGroups.delete(group.config.id);
      clearWerkstattRuntimeStatus(group.config.id);
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

  private bindSidechains(updated?: {
    soundId: string;
    groups: OfficialEffectGroup[];
  }): void {
    const bind = (
      group: OfficialEffectGroup,
      target: SoundUnit["audioUnitBox"] | null
    ): void => {
      bindOfficialSidechain(
        this.adapterContext(),
        group,
        group.config.sidechain ? target : null
      );
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
      const groups =
        updated?.soundId === soundId ? updated.groups : unit.groups;
      for (const group of groups) {
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

function canKeepDevice(before: EffectConfig, after: EffectConfig): boolean {
  return (
    before.type === after.type &&
    !(
      before.type === "neuralAmp" &&
      after.type === "neuralAmp" &&
      (before.modelId !== after.modelId || before.modelData !== after.modelData)
    )
  );
}

function werkstattSource(
  config: Extract<EffectConfig, { type: "werkstatt" }>
): string {
  return config.code ?? config.source;
}

function restoreGroup(
  group: OfficialEffectGroup,
  graph: Project["boxGraph"]
): OfficialEffectGroup {
  // Rollback recreates deleted boxes, so cached handles must follow their UUIDs.
  const restore = <T extends { address?: { uuid: Uint8Array } } | null>(
    box: T
  ): T =>
    box?.address
      ? (graph.findBox(box.address.uuid).unwrap() as unknown as T)
      : box;
  return {
    ...group,
    cells: new Map([...group.cells].map(([id, cell]) => [id, restore(cell)])),
    device: restore(group.device),
    inputTrim: restore(group.inputTrim),
    model: restore(group.model),
    outputTrim: restore(group.outputTrim),
    signalTrim: restore(group.signalTrim),
    wrapper: restore(group.wrapper),
  };
}
