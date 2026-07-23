import { UUID } from "@opendaw/lib-std";
import type { EngineWorklet, Project, ProjectEnv } from "@opendaw/studio-core";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  clearWerkstattRuntimeStatus,
  setWerkstattRuntimeStatus,
} from "../dsp/effects/werkstatt-runtime-status.js";
import type { EffectsGraphRuntime } from "./effects-graph-runtime.js";
import {
  bindOfficialSidechain,
  createMasterRack,
  createOfficialEffectGroup,
  deleteOfficialEffectGroups,
  type OfficialEffectGroup,
  restoreWerkstattParameterValues,
  setMasterRackDryWet,
  updateWerkstattEffectGroup,
} from "./official-opendaw-effect-adapter.js";
import { ensureOpenDawAudioWorklets } from "./opendaw-audio-worklets.js";

const MAX_STEREO_MONITORING_SOURCES = 4;

export const DEFAULT_OPENDAW_RUNTIME_URLS = {
  processorUrl: "/opendaw/processors.js",
  wasmProcessorUrl: "/opendaw/wasm-processor.js",
  offlineWorkerUrl: "/opendaw/wasm-offline-worker.js",
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
type Terminable = { terminate(): void };

type SoundUnit = ReturnType<Project["api"]["createAnyInstrument"]> & {
  effects: EffectConfig[];
  groups: OfficialEffectGroup[];
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
    record: () => undefined,
    invalidate: () => undefined,
    remove: () => undefined,
    register: unavailable,
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
  private readonly werkstattRevisions = new Map<string, number>();
  private readonly werkstattSubscriptions = new Map<string, Terminable>();
  private initializePromise: Promise<void> | null = null;
  private project: Project | null = null;
  private worklet: EngineWorklet | null = null;
  private modules: RuntimeModules | null = null;
  private werkstattCompiler: WerkstattCompiler | null = null;
  private bpm = 120;
  private closed = false;

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
    return this.project !== null && this.worklet !== null;
  }

  get soundCount(): number {
    return this.soundUnits.size;
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
    const { AudioWorklets, Project, SampleService } = modules.core;

    modules.wasm.WasmEngine.install({
      processorUrl: this.urls.wasmProcessorUrl,
      offlineWorkerUrl: this.urls.offlineWorkerUrl,
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

    const project = Project.new({
      audioContext: this.context,
      audioWorklets,
      sampleManager: unavailableAssetManager(),
      soundfontManager: unavailableSoundfontManager(),
      sampleService: new SampleService(this.context),
      soundfontService: undefined as unknown as ProjectEnv["soundfontService"],
    });
    const worklet = project.startAudioWorklet();

    // Project.startAudioWorklet connects the normal master output. Live radio
    // uses only the per-source monitor returns; leaving output 0 connected
    // would duplicate the signal.
    worklet.disconnect(this.context.destination, 0, 0);
    await worklet.isReady();
    worklet.play();

    if (this.closed) {
      project.terminate();
      throw new Error("openDAW runtime initialization was canceled");
    }

    this.modules = modules;
    this.project = project;
    this.worklet = worklet;
    this.werkstattCompiler = modules.adapters.ScriptCompiler.create({
      headerTag: "werkstatt",
      registryName: "werkstattProcessors",
      functionName: "werkstatt",
    });
  }

  async connectSound(
    soundId: string,
    source: AudioNode,
    destination: AudioNode
  ): Promise<void> {
    if (
      source.context !== this.context ||
      destination.context !== this.context
    ) {
      throw new Error("openDAW monitoring nodes must share one AudioContext");
    }
    await this.initialize();

    const project = this.requireProject();
    const worklet = this.requireWorklet();
    let unit = this.soundUnits.get(soundId);

    if (!unit) {
      if (this.soundUnits.size >= MAX_STEREO_MONITORING_SOURCES) {
        throw new Error(
          `openDAW monitoring supports at most ${MAX_STEREO_MONITORING_SOURCES} stereo sounds`
        );
      }
      const product = project.editing
        .modify(() => {
          const created = project.api.createInstrument(
            this.requireModules().adapters.InstrumentFactories.Tape,
            { name: `Radio ${this.soundUnits.size + 1}` }
          );
          const rack = createMasterRack(
            this.adapterContext(),
            created.audioUnitBox.audioEffects
          );
          return { ...created, rack };
        })
        .unwrap();
      unit = {
        ...product,
        effects: [],
        groups: [],
        source: null,
        destination: null,
      };
      this.soundUnits.set(soundId, unit);
    } else if (unit.source === source && unit.destination === destination) {
      this.bindSidechains();
      return;
    } else if (unit.source !== null) {
      worklet.unregisterMonitoringSource(unit.audioUnitBox.address.uuid);
    }

    worklet.registerMonitoringSource(
      unit.audioUnitBox.address.uuid,
      source,
      2,
      destination
    );
    unit.source = source;
    unit.destination = destination;
    this.bindSidechains();
  }

  disconnectSound(soundId: string): void {
    const unit = this.soundUnits.get(soundId);
    if (!(unit && this.worklet && unit.source)) {
      return;
    }
    this.worklet.unregisterMonitoringSource(unit.audioUnitBox.address.uuid);
    unit.source = null;
    unit.destination = null;
    this.bindSidechains();
  }

  deleteSound(soundId: string): void {
    const unit = this.soundUnits.get(soundId);
    if (!unit) {
      return;
    }
    this.disconnectSound(soundId);
    const project = this.project;
    if (project) {
      this.releaseWerkstattGroups(unit.groups);
      project.editing.modify(() =>
        project.api.deleteAudioUnit(unit.audioUnitBox)
      );
    }
    this.soundUnits.delete(soundId);
    this.sidechainTargets.delete(soundId);
    this.bindSidechains();
  }

  syncEffects(soundId: string, effects: readonly EffectConfig[]): void {
    const unit = this.soundUnits.get(soundId);
    const project = this.project;
    if (!(unit && project)) {
      return;
    }
    const nextEffects = effects
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((effect) => structuredClone(effect));
    const previousEffects = unit.effects;
    const stableUpdates = stableWerkstattUpdates(previousEffects, nextEffects);
    if (stableUpdates !== null) {
      const groupsById = new Map(
        flattenGroups(unit.groups).map((group) => [group.config.id, group])
      );
      const nextById = new Map(
        flattenEffects(nextEffects).map((config) => [config.id, config])
      );
      project.editing.modify(() => {
        for (const group of groupsById.values()) {
          const next = nextById.get(group.config.id);
          if (next) {
            group.config = next;
          }
        }
        for (const { after, before } of stableUpdates) {
          const group = groupsById.get(after.id);
          if (group) {
            updateWerkstattEffectGroup(group, after);
            if (werkstattSource(before) === werkstattSource(after)) {
              restoreWerkstattParameterValues(group, after.parameters);
            }
          }
        }
        unit.effects = nextEffects;
      });
      for (const { after, before } of stableUpdates) {
        const group = groupsById.get(after.id);
        if (group && werkstattSource(before) !== werkstattSource(after)) {
          this.compileWerkstattGroup(group, after);
        }
      }
      return;
    }

    this.releaseWerkstattGroups(unit.groups);
    project.editing.modify(() => {
      deleteOfficialEffectGroups(unit.groups);
      unit.effects = nextEffects;
      unit.groups = unit.effects.map((effect, index) =>
        createOfficialEffectGroup(
          this.adapterContext(),
          effect,
          unit.rack.wet.audioEffects,
          index * 2
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
    if (this.project) {
      this.project.editing.modify(() => this.bindSidechains());
    }
  }

  setDryWet(soundId: string, value: number): void {
    const unit = this.soundUnits.get(soundId);
    const project = this.project;
    if (!(unit && project)) {
      return;
    }
    project.editing.modify(() => setMasterRackDryWet(unit.rack, value));
  }

  setTempo(bpm: number): void {
    const project = this.project;
    if (!project) {
      return;
    }
    this.bpm = Math.max(30, Math.min(1000, bpm));
    project.editing.modify(() => project.api.setBpm(this.bpm));
  }

  cleanup(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const soundId of this.soundUnits.keys()) {
      this.disconnectSound(soundId);
    }
    this.soundUnits.clear();
    this.sidechainTargets.clear();
    for (const subscription of this.werkstattSubscriptions.values()) {
      subscription.terminate();
    }
    for (const effectId of this.werkstattSubscriptions.keys()) {
      clearWerkstattRuntimeStatus(effectId);
    }
    this.werkstattSubscriptions.clear();
    this.werkstattRevisions.clear();
    this.project?.terminate();
    this.project = null;
    this.worklet = null;
    this.modules = null;
    this.werkstattCompiler = null;
    this.initializePromise = null;
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

  private requireWorklet(): EngineWorklet {
    if (!this.worklet) {
      throw new Error("openDAW runtime is not initialized");
    }
    return this.worklet;
  }

  private adapterContext() {
    const modules = this.requireModules();
    return {
      boxes: modules.boxes,
      core: modules.core,
      project: this.requireProject(),
      bpm: this.bpm,
    };
  }

  private compileWerkstattGroup(
    group: OfficialEffectGroup,
    config: Extract<EffectConfig, { type: "werkstatt" }>
  ): void {
    const compiler = this.werkstattCompiler;
    const project = this.project;
    if (!(compiler && project)) {
      return;
    }
    this.subscribeWerkstattMessages(group, config.id);
    const revision = (this.werkstattRevisions.get(config.id) ?? 0) + 1;
    this.werkstattRevisions.set(config.id, revision);
    setWerkstattRuntimeStatus(config.id, {
      state: "compiling",
      message: "Compiling locally in the openDAW audio worklet…",
    });
    compiler
      .compile(
        this.context,
        project.editing,
        group.device as never,
        config.code ?? config.source
      )
      .then(() => {
        if (this.werkstattRevisions.get(config.id) !== revision) {
          return;
        }
        project.editing.modify(() =>
          restoreWerkstattParameterValues(group, config.parameters)
        );
        setWerkstattRuntimeStatus(config.id, {
          state: "ready",
          message: "Compiled and running in the client-side audio worklet.",
        });
      })
      .catch((cause: unknown) => {
        if (this.werkstattRevisions.get(config.id) !== revision) {
          return;
        }
        setWerkstattRuntimeStatus(config.id, {
          state: "error",
          message:
            cause instanceof Error ? cause.message : "Compilation failed.",
        });
      });
  }

  private subscribeWerkstattMessages(
    group: OfficialEffectGroup,
    effectId: string
  ): void {
    if (this.werkstattSubscriptions.has(effectId)) {
      return;
    }
    const device = group.device as unknown as {
      address: { uuid: Uint8Array };
    };
    const subscription = this.requireWorklet().subscribeDeviceMessage(
      UUID.toString(device.address.uuid),
      (message) =>
        setWerkstattRuntimeStatus(effectId, {
          state: "error",
          message,
        })
    );
    this.werkstattSubscriptions.set(effectId, subscription);
  }

  private releaseWerkstattGroups(groups: readonly OfficialEffectGroup[]): void {
    for (const group of flattenGroups(groups)) {
      if (group.config.type !== "werkstatt") {
        continue;
      }
      this.werkstattSubscriptions.get(group.config.id)?.terminate();
      this.werkstattSubscriptions.delete(group.config.id);
      this.werkstattRevisions.delete(group.config.id);
      clearWerkstattRuntimeStatus(group.config.id);
    }
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
}

export type { RuntimeModuleLoader };

function flattenGroups(
  groups: readonly OfficialEffectGroup[]
): OfficialEffectGroup[] {
  return groups.flatMap((group) => [group, ...flattenGroups(group.children)]);
}

function stableWerkstattUpdates(
  previous: readonly EffectConfig[],
  next: readonly EffectConfig[]
): Array<{
  before: Extract<EffectConfig, { type: "werkstatt" }>;
  after: Extract<EffectConfig, { type: "werkstatt" }>;
}> | null {
  const previousFlat = flattenEffects(previous);
  const nextFlat = flattenEffects(next);
  if (previousFlat.length !== nextFlat.length) {
    return null;
  }
  const updates: Array<{
    before: Extract<EffectConfig, { type: "werkstatt" }>;
    after: Extract<EffectConfig, { type: "werkstatt" }>;
  }> = [];
  for (let index = 0; index < previousFlat.length; index++) {
    const before = previousFlat[index];
    const after = nextFlat[index];
    if (
      !(before && after) ||
      before.id !== after.id ||
      before.type !== after.type ||
      before.order !== after.order
    ) {
      return null;
    }
    if (
      JSON.stringify(localEffectConfig(before)) ===
      JSON.stringify(localEffectConfig(after))
    ) {
      continue;
    }
    if (before.type !== "werkstatt" || after.type !== "werkstatt") {
      return null;
    }
    updates.push({ after, before });
  }
  return updates;
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
