import { captureError } from "@avoid.quest/error";
import type {
  DesiredEffectsState,
  EffectsRuntimeOutcome,
} from "../../channel-effects.js";
import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  isOfficialOpenDawEffect,
  selectOfficialEffects,
} from "../dsp/effects/official-opendaw-mapping.js";
import { clampEffectTempo } from "../dsp/effects/tempo.js";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  effectFieldsAreStructural,
  findEffectInTree,
  updateEffectInTree,
} from "../dsp/routing/effect-tree.js";
import {
  type AudioState,
  getAudioContext,
  WorkletManager,
} from "../playback/index.js";
import {
  convertEffectConfig,
  toPlainEffectConfig,
} from "./audio-manager-effects.js";
import { attachWorkletManagerListeners } from "./audio-manager-graph.js";
import type { SoundInstance } from "./audio-manager-types.js";
import {
  type EffectsBackend,
  EffectsBackendRouter,
} from "./effects-backend-router.js";
import type {
  EffectsGraphRuntime,
  EffectsPerformanceSnapshot,
  EffectWriteResult,
} from "./effects-graph-runtime.js";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime.js";

type SidechainConnection = { source: AudioNode; target: AudioNode };

type SoundEffectsState = {
  compatibilitySourceCreated: boolean;
  desiredSidechainSoundId: string | null;
  dryWet: number;
  effects: EffectConfig[];
  generation: number;
  graph: EffectsBackendRouter | null;
  inputChannels: 1 | 2;
  manager: WorkletManager | null;
  managerPromise: Promise<WorkletManager> | null;
  officialConnected: boolean;
  officialConnectingGeneration: number | null;
  outcome: EffectsRuntimeOutcome;
  sidechain: SidechainConnection | null;
  tempo: number;
};

type EffectsControllerOptions = {
  workletProcessorUrl: () => string;
  sounds: Map<string, SoundInstance>;
  notifyListeners: (soundId: string, state: AudioState) => void;
  createOfficialRuntime?: (context: AudioContext) => EffectsGraphRuntime;
  createWorkletManager?: (
    context: AudioContext,
    processorUrl: string
  ) => WorkletManager;
};

const createSoundState = (): SoundEffectsState => ({
  compatibilitySourceCreated: false,
  desiredSidechainSoundId: null,
  dryWet: 1,
  effects: [],
  generation: 0,
  graph: null,
  inputChannels: 2,
  manager: null,
  managerPromise: null,
  officialConnected: false,
  officialConnectingGeneration: null,
  outcome: { backend: null, ready: false, status: "inactive" },
  sidechain: null,
  tempo: 120,
});

class EffectsController {
  private officialRuntime: EffectsGraphRuntime | null = null;
  private officialRuntimeUnavailable = false as boolean;
  private officialRuntimeWarningReported = false as boolean;
  private readonly officialRegisteredSoundIds = new Set<string>();
  private readonly officialSoundOwners = new Map<string, number>();
  private nextOfficialRuntimeGeneration = 0;
  private nextGeneration = 0;
  private readonly states = new Map<string, SoundEffectsState>();
  private readonly workletProcessorUrl: () => string;
  private readonly sounds: Map<string, SoundInstance>;
  private readonly notifyListeners: (
    soundId: string,
    state: AudioState
  ) => void;
  private readonly createOfficialRuntime: (
    context: AudioContext
  ) => EffectsGraphRuntime;
  private readonly createWorkletManager: (
    context: AudioContext,
    processorUrl: string
  ) => WorkletManager;

  constructor({
    workletProcessorUrl,
    sounds,
    notifyListeners,
    createOfficialRuntime = (context) => new OfficialOpenDawRuntime(context),
    createWorkletManager = (context, processorUrl) =>
      new WorkletManager(context, processorUrl),
  }: EffectsControllerOptions) {
    this.workletProcessorUrl = workletProcessorUrl;
    this.sounds = sounds;
    this.notifyListeners = notifyListeners;
    this.createOfficialRuntime = createOfficialRuntime;
    this.createWorkletManager = createWorkletManager;
  }

  private getState(soundId: string): SoundEffectsState {
    const state = this.states.get(soundId) ?? createSoundState();
    this.states.set(soundId, state);
    return state;
  }

  private advance(state: SoundEffectsState): number {
    this.nextGeneration += 1;
    state.generation = this.nextGeneration;
    return state.generation;
  }

  private advanceOfficialRuntime(): number {
    this.nextOfficialRuntimeGeneration += 1;
    return this.nextOfficialRuntimeGeneration;
  }

  private claimOfficialSound(soundId: string): number {
    const generation = this.advanceOfficialRuntime();
    this.officialSoundOwners.set(soundId, generation);
    return generation;
  }

  private deleteOfficialSound(
    soundId: string,
    runtime = this.officialRuntime,
    expectedOwner?: number
  ): boolean {
    if (
      !runtime ||
      (expectedOwner !== undefined &&
        this.officialSoundOwners.get(soundId) !== expectedOwner)
    ) {
      return false;
    }
    runtime.deleteSound(soundId, this.claimOfficialSound(soundId));
    this.officialRegisteredSoundIds.delete(soundId);
    return true;
  }

  private shouldProcess(state: SoundEffectsState): boolean {
    return state.dryWet > 0 && hasEnabledEffects(state.effects);
  }

  getRuntimeOutcome(soundId: string): EffectsRuntimeOutcome {
    return (
      this.states.get(soundId)?.outcome ?? {
        backend: null,
        ready: false,
        status: "inactive",
      }
    );
  }

  getPerformanceSnapshot(): EffectsPerformanceSnapshot | null {
    return this.officialRuntime?.getPerformanceSnapshot?.() ?? null;
  }

  async reconcile(
    soundId: string,
    desired: DesiredEffectsState
  ): Promise<EffectsRuntimeOutcome> {
    if (!this.sounds.has(soundId)) {
      return {
        backend: null,
        error: new Error(`Sound with id ${soundId} not found`),
        ready: false,
        status: "failed",
      };
    }
    const state = this.getState(soundId);
    const previousEffects = state.effects;
    const nextEffects = desired.tree.map((effect) =>
      toPlainEffectConfig(effect)
    );
    const nextDryWet = Math.max(0, Math.min(1, desired.dryWet));
    const nextTempo = clampEffectTempo(desired.tempo);
    const unchanged =
      JSON.stringify({
        dryWet: state.dryWet,
        effects: previousEffects,
        sidechainSoundId: state.desiredSidechainSoundId,
        tempo: state.tempo,
      }) ===
      JSON.stringify({
        dryWet: nextDryWet,
        effects: nextEffects,
        sidechainSoundId: desired.sidechainSoundId,
        tempo: nextTempo,
      });

    state.effects = nextEffects;
    state.dryWet = nextDryWet;
    state.desiredSidechainSoundId = desired.sidechainSoundId;
    state.tempo = nextTempo;

    if (state.compatibilitySourceCreated && !unchanged) {
      this.reconcileCompatibility(soundId, state, previousEffects, nextEffects);
    }
    this.bindCompatibilitySidechain(state);
    this.pruneOfficialSidechainSources();

    if (!state.graph) {
      state.outcome = { backend: null, ready: false, status: "inactive" };
      return state.outcome;
    }
    if (unchanged && state.outcome.status === "ready") {
      return state.outcome;
    }

    const generation = this.advance(state);
    try {
      await this.selectRuntime(soundId, state, generation);
      if (state.generation !== generation) {
        return { backend: null, ready: false, status: "superseded" };
      }
      state.outcome = this.readyOutcome(state);
    } catch (error) {
      if (state.generation !== generation) {
        return { backend: null, ready: false, status: "superseded" };
      }
      state.outcome = {
        backend: "bypass",
        error: error instanceof Error ? error : new Error(String(error)),
        ready: true,
        status: "failed",
      };
      this.switchBackend(soundId, state, "bypass", generation);
      captureError(error, {
        operation: "reconcileEffectsRuntime",
        surface: "ui",
      });
    }
    return state.outcome;
  }

  setEffectFields(
    soundId: string,
    effectId: string,
    config: EffectConfig
  ): EffectWriteResult {
    const state = this.states.get(soundId);
    const before = state && findEffectInTree(state.effects, effectId);
    if (!(before && this.sounds.has(soundId))) {
      return "unavailable";
    }
    if (effectFieldsAreStructural(before, config)) {
      return "structural";
    }
    const next = updateEffectInTree(
      state.effects,
      effectId,
      toPlainEffectConfig(config)
    );
    if (state.outcome.backend === "compatibility") {
      return "structural";
    }
    if (
      (state.officialConnectingGeneration !== null &&
        !state.officialConnected) ||
      !state.graph
    ) {
      state.effects = next;
      return "applied";
    }
    if (!state.officialConnected) {
      if (!this.shouldProcess(state)) {
        state.effects = next;
        return "applied";
      }
      return "structural";
    }
    if (!(config.enabled || isOfficialOpenDawEffect(config))) {
      state.effects = next;
      return "applied";
    }
    const result =
      this.officialRuntime?.writeEffect(soundId, effectId, config) ??
      "unavailable";
    if (result === "applied") {
      state.effects = next;
    }
    return result;
  }

  private readyOutcome(state: SoundEffectsState): EffectsRuntimeOutcome {
    if (!this.shouldProcess(state)) {
      return { backend: "bypass", ready: true, status: "ready" };
    }
    if (state.officialConnected) {
      return { backend: "official", ready: true, status: "ready" };
    }
    if (state.compatibilitySourceCreated) {
      return { backend: "compatibility", ready: true, status: "ready" };
    }
    return {
      backend: null,
      error: new Error("No Effects runtime became ready"),
      ready: false,
      status: "failed",
    };
  }

  private reconcileCompatibility(
    soundId: string,
    state: SoundEffectsState,
    previous: readonly EffectConfig[],
    next: readonly EffectConfig[]
  ): void {
    const { manager } = state;
    if (!manager) {
      return;
    }
    const previousById = new Map(previous.map((effect) => [effect.id, effect]));
    const nextById = new Map(next.map((effect) => [effect.id, effect]));

    for (const effect of previous) {
      const replacement = nextById.get(effect.id);
      if (!replacement || replacement.type !== effect.type) {
        manager.removeEffect(soundId, effect.id);
      }
    }
    for (const effect of next) {
      const existing = previousById.get(effect.id);
      if (!existing || existing.type !== effect.type) {
        manager.addEffect(
          soundId,
          effect.id,
          effect.type,
          convertEffectConfig(effect),
          effect.order
        );
      } else if (JSON.stringify(existing) !== JSON.stringify(effect)) {
        manager.updateEffect(soundId, effect.id, convertEffectConfig(effect));
      }
    }
    manager.reorderEffects(
      soundId,
      next.map((effect) => effect.id)
    );
    manager.setEffectsDryWet(soundId, state.dryWet);
    manager.setTempo(soundId, state.tempo);
    this.bindCompatibilitySidechain(state);
  }

  private disconnectCompatibilitySidechain(state: SoundEffectsState): void {
    if (!state.sidechain) {
      return;
    }
    try {
      state.sidechain.source.disconnect(state.sidechain.target, 0, 1);
    } catch {
      // The source graph may already have removed the edge.
    }
    state.sidechain = null;
  }

  private bindCompatibilitySidechain(state: SoundEffectsState): boolean {
    this.disconnectCompatibilitySidechain(state);
    if (!(state.desiredSidechainSoundId && state.compatibilitySourceCreated)) {
      return true;
    }
    const source = this.sounds.get(state.desiredSidechainSoundId)?.nodes
      ?.filter;
    const target = state.manager?.node;
    if (!(source && target)) {
      return false;
    }
    source.connect(target, 0, 1);
    state.sidechain = { source, target };
    return true;
  }

  private refreshSidechains(): void {
    for (const state of this.states.values()) {
      this.bindCompatibilitySidechain(state);
    }
  }

  private async getOrCreateWorkletManager(
    soundId: string
  ): Promise<WorkletManager> {
    const state = this.getState(soundId);
    if (state.manager) {
      return state.manager;
    }
    if (state.managerPromise) {
      return state.managerPromise;
    }

    const context =
      (state.graph?.source.context as AudioContext | undefined) ??
      getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    const manager = this.createWorkletManager(
      context,
      this.workletProcessorUrl()
    );
    let managerPromise: Promise<WorkletManager>;
    managerPromise = manager.init().then(() => {
      if (state.managerPromise !== managerPromise) {
        manager.cleanup();
        throw new Error(
          `Effect runtime initialization canceled for ${soundId}`
        );
      }
      state.manager = manager;
      attachWorkletManagerListeners({
        notifyListeners: this.notifyListeners,
        sounds: this.sounds,
        wm: manager,
      });
      this.refreshSidechains();
      return manager;
    });
    state.managerPromise = managerPromise;

    try {
      return await managerPromise;
    } finally {
      if (state.managerPromise === managerPromise) {
        state.managerPromise = null;
      }
    }
  }

  async connectGraph(
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    inputChannels: 1 | 2 = 2
  ): Promise<boolean> {
    const state = this.getState(soundId);
    this.disconnectGraph(soundId, state);
    state.inputChannels = inputChannels;

    const shouldProcess = this.shouldProcess(state);
    // Keep effectful sources silent while their requested backend prepares,
    // but make the dry path available synchronously for the mobile play call.
    state.graph = new EffectsBackendRouter(source, destination, shouldProcess);
    const generation = this.advance(state);
    // A source can be replaced independently of the compatibility effect that
    // consumes it as a sidechain. Rebind existing intents to the new native
    // graph without forcing this (possibly dry) source through a worklet.
    this.refreshSidechains();
    if (!shouldProcess) {
      // A dry source may already feed an official sidechain. Its media graph
      // can be reconstructed independently, so replace the official
      // non-monitoring registration with this exact AudioNode. This does not
      // create a compatibility runtime for the source.
      this.registerNonOfficialSource(soundId, state, generation).catch(
        (error: unknown) => {
          if (
            this.states.get(soundId) === state &&
            state.generation === generation
          ) {
            captureError(error, {
              operation: "registerEffectsSidechain",
              surface: "ui",
            });
          }
        }
      );
      state.outcome = { backend: "bypass", ready: true, status: "ready" };
      return true;
    }

    try {
      await this.selectRuntime(soundId, state, generation);
    } catch (error) {
      const ownsGraph = state.graph?.source === source;
      if (ownsGraph && state.generation === generation) {
        this.switchBackend(soundId, state, "bypass", generation);
        state.outcome = {
          backend: "bypass",
          error: error instanceof Error ? error : new Error(String(error)),
          ready: true,
          status: "failed",
        };
        captureError(error, {
          operation: "connectEffectsRuntime",
          surface: "ui",
        });
      }
      return ownsGraph;
    }
    // Runtime selection can be superseded by an effect edit while it awaits a
    // worklet. The stable router is still valid and the newer generation owns
    // the eventual backend; returning false here would make AudioManager add a
    // second dry edge alongside this graph.
    const ownsGraph = state.graph?.source === source;
    if (ownsGraph && state.generation === generation) {
      state.outcome = this.readyOutcome(state);
    }
    return ownsGraph;
  }

  private async ensureCompatibilitySource(
    soundId: string,
    state: SoundEffectsState,
    generation: number
  ): Promise<boolean> {
    if (
      state.generation !== generation ||
      this.states.get(soundId) !== state ||
      !state.graph
    ) {
      return false;
    }
    const manager = await this.getOrCreateWorkletManager(soundId);
    if (
      state.generation !== generation ||
      this.states.get(soundId) !== state ||
      !state.graph ||
      !(manager.node && manager.outputNode)
    ) {
      return false;
    }
    if (!state.compatibilitySourceCreated) {
      manager.createStreamSource(soundId);
      state.compatibilitySourceCreated = true;
      this.replayCompatibilityState(soundId, state);
      manager.startSource(soundId);
    }
    this.connectCompatibilityGraph(state);
    this.refreshSidechains();
    return true;
  }

  private replayCompatibilityState(
    soundId: string,
    state: SoundEffectsState
  ): void {
    const { manager } = state;
    if (!manager) {
      return;
    }
    for (const effect of state.effects
      .slice()
      .sort((left, right) => left.order - right.order)) {
      manager.addEffect(
        soundId,
        effect.id,
        effect.type,
        convertEffectConfig(effect),
        effect.order
      );
    }
    manager.setEffectsDryWet(soundId, state.dryWet);
    manager.setTempo(soundId, state.tempo);
  }

  pauseSource(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    state.manager?.pauseSource(soundId);
    const generation = this.advance(state);
    this.switchBackend(soundId, state, "muted", generation);
  }

  resumeSource(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    state.manager?.resumeSource(soundId);
    this.refreshRuntimeSelection(soundId);
  }

  stopSource(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    state.manager?.stopSource(soundId);
    const generation = this.advance(state);
    this.switchBackend(soundId, state, "muted", generation);
  }

  cleanupSound(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    this.advance(state);
    this.disconnectCompatibilitySidechain(state);
    this.disconnectGraph(soundId, state);
    if (state.officialConnectingGeneration !== null) {
      this.deleteOfficialSound(soundId);
      state.officialConnectingGeneration = null;
    }
    state.managerPromise = null;
    state.manager?.cleanup();
    state.manager = null;
    this.states.delete(soundId);

    for (const other of this.states.values()) {
      if (other.desiredSidechainSoundId === soundId) {
        this.bindCompatibilitySidechain(other);
      }
    }
    this.pruneOfficialSidechainSources();
  }

  cleanup(): void {
    for (const [soundId, state] of this.states) {
      this.advance(state);
      this.disconnectCompatibilitySidechain(state);
      this.disconnectGraph(soundId, state);
      if (state.officialConnectingGeneration !== null) {
        this.deleteOfficialSound(soundId);
        state.officialConnectingGeneration = null;
      }
      state.managerPromise = null;
      state.manager?.cleanup();
    }
    this.states.clear();
    this.officialRegisteredSoundIds.clear();
    this.officialSoundOwners.clear();
    this.officialRuntime?.cleanup();
    this.officialRuntime = null;
  }

  private async selectRuntime(
    soundId: string,
    state: SoundEffectsState,
    generation: number
  ): Promise<void> {
    if (!this.shouldProcess(state)) {
      if (state.officialConnectingGeneration !== null) {
        this.releaseOfficialSound(soundId, state);
      }
      this.switchBackend(soundId, state, "bypass", generation);
      await this.registerNonOfficialSource(soundId, state, generation);
      return;
    }

    if (
      canUseOfficialOpenDawRuntime(state.effects) &&
      (await this.connectOfficial(soundId, state, generation))
    ) {
      this.switchBackend(soundId, state, "official", generation);
      return;
    }

    if (await this.ensureCompatibilitySource(soundId, state, generation)) {
      this.switchBackend(soundId, state, "compatibility", generation);
      await this.registerNonOfficialSource(soundId, state, generation);
    }
  }

  private isCurrentOfficialAttempt(
    soundId: string,
    state: SoundEffectsState,
    generation: number,
    graph: EffectsBackendRouter,
    runtime: EffectsGraphRuntime,
    runtimeGeneration: number
  ): boolean {
    return (
      state.generation === generation &&
      state.graph === graph &&
      this.officialRuntime === runtime &&
      this.officialSoundOwners.get(soundId) === runtimeGeneration &&
      canUseOfficialOpenDawRuntime(state.effects)
    );
  }

  private releaseOfficialSound(
    soundId: string,
    state: SoundEffectsState,
    runtime = this.officialRuntime,
    runtimeGeneration?: number
  ): boolean {
    if (
      this.states.get(soundId) !== state ||
      !this.deleteOfficialSound(soundId, runtime, runtimeGeneration)
    ) {
      return false;
    }
    state.officialConnected = false;
    this.pruneOfficialSidechainSources();
    return true;
  }

  private handleOfficialConnectionFailure(
    soundId: string,
    state: SoundEffectsState,
    runtime: EffectsGraphRuntime,
    runtimeGeneration: number,
    wasOfficialConnected: boolean,
    isStale: boolean,
    error: unknown
  ): void {
    if (!wasOfficialConnected) {
      this.releaseOfficialSound(soundId, state, runtime, runtimeGeneration);
    }
    if (!isStale) {
      this.reportOfficialRuntimeFailure(error);
    }
  }

  private async connectOfficial(
    soundId: string,
    state: SoundEffectsState,
    generation: number
  ): Promise<boolean> {
    if (this.officialRuntimeUnavailable) {
      return false;
    }
    if (globalThis.crossOriginIsolated !== true) {
      this.officialRuntimeUnavailable = true;
      this.reportOfficialRuntimeFailure(
        new Error("Cross-origin isolation is unavailable")
      );
      return false;
    }
    const { graph } = state;
    if (!(graph && canUseOfficialOpenDawRuntime(state.effects))) {
      return false;
    }

    const runtime =
      this.officialRuntime ??
      this.createOfficialRuntime(graph.source.context as AudioContext);
    this.officialRuntime = runtime;
    state.officialConnectingGeneration = generation;
    const wasOfficialConnected = state.officialConnected;
    const runtimeGeneration = this.claimOfficialSound(soundId);
    try {
      const connectingEffects = state.effects;
      const connected = await runtime.connectSound(
        soundId,
        graph.source,
        graph.officialGain,
        runtimeGeneration,
        state.inputChannels,
        {
          dryWet: state.dryWet,
          effects: selectOfficialEffects(state.effects),
          sidechainSoundId: state.desiredSidechainSoundId,
          tempo: state.tempo,
        }
      );
      if (
        !(
          connected &&
          this.isCurrentOfficialAttempt(
            soundId,
            state,
            generation,
            graph,
            runtime,
            runtimeGeneration
          )
        )
      ) {
        if (connected && state.officialConnectingGeneration === generation) {
          this.releaseOfficialSound(soundId, state, runtime, runtimeGeneration);
        }
        return false;
      }

      // Knobs may have changed while the worklet initialized; connect used a snapshot.
      if (state.effects !== connectingEffects) {
        runtime.syncEffects(soundId, selectOfficialEffects(state.effects));
      }
      this.officialRegisteredSoundIds.add(soundId);
      state.officialConnected = true;
      await this.registerNonOfficialSources(runtime, soundId);
      return (
        state.generation === generation &&
        state.graph === graph &&
        state.officialConnected
      );
    } catch (error) {
      const isStale =
        state.generation !== generation ||
        state.graph !== graph ||
        this.officialRuntime !== runtime;
      // A rejected connect can leave a partially created unit behind. The
      // owner token prevents stale work from deleting a newer monitoring or
      // non-monitoring registration for the same sound.
      this.handleOfficialConnectionFailure(
        soundId,
        state,
        runtime,
        runtimeGeneration,
        wasOfficialConnected,
        isStale,
        error
      );
      return false;
    } finally {
      if (state.officialConnectingGeneration === generation) {
        state.officialConnectingGeneration = null;
      }
    }
  }

  private async registerNonOfficialSources(
    runtime: EffectsGraphRuntime,
    exceptSoundId: string
  ): Promise<void> {
    const targets = this.officialSidechainTargets();
    this.pruneOfficialSidechainSources(targets);
    for (const [soundId, state] of this.states) {
      if (
        soundId === exceptSoundId ||
        !targets.has(soundId) ||
        state.officialConnected ||
        state.officialConnectingGeneration === state.generation ||
        !state.graph
      ) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: registrations mutate shared runtime ownership in order
      await this.registerNonOfficialSource(soundId, state, state.generation);
    }
    for (const [soundId, state] of this.states) {
      runtime.setSidechainTarget(soundId, state.desiredSidechainSoundId);
    }
  }

  private async registerNonOfficialSource(
    soundId: string,
    state: SoundEffectsState,
    generation: number
  ): Promise<void> {
    const runtime = this.officialRuntime;
    const { graph } = state;
    const isOfficialSidechain = [...this.states.values()].some(
      (candidate) =>
        candidate.officialConnected &&
        candidate.desiredSidechainSoundId === soundId
    );
    if (
      !(runtime && graph && isOfficialSidechain) ||
      state.officialConnected ||
      state.officialConnectingGeneration === state.generation ||
      this.states.get(soundId) !== state ||
      state.generation !== generation
    ) {
      return;
    }
    const runtimeGeneration = this.claimOfficialSound(soundId);
    const connected = await runtime.connectSidechainSource(
      soundId,
      graph.source,
      runtimeGeneration,
      state.inputChannels
    );
    if (!connected) {
      return;
    }
    const remainsSidechain = this.officialSidechainTargets().has(soundId);
    if (
      this.officialSoundOwners.get(soundId) !== runtimeGeneration ||
      this.states.get(soundId) !== state ||
      state.generation !== generation ||
      state.officialConnected ||
      !remainsSidechain
    ) {
      this.deleteOfficialSound(soundId, runtime, runtimeGeneration);
      return;
    }
    this.officialRegisteredSoundIds.add(soundId);
  }

  private officialSidechainTargets(): Set<string> {
    return new Set(
      [...this.states.values()]
        .filter((state) => state.officialConnected)
        .map((state) => state.desiredSidechainSoundId)
        .filter((soundId): soundId is string => soundId !== null)
    );
  }

  private pruneOfficialSidechainSources(
    targets = this.officialSidechainTargets()
  ): void {
    const runtime = this.officialRuntime;
    if (!runtime) {
      return;
    }
    for (const [soundId, state] of this.states) {
      if (
        this.officialRegisteredSoundIds.has(soundId) &&
        !state.officialConnected &&
        state.officialConnectingGeneration === null &&
        !targets.has(soundId)
      ) {
        this.deleteOfficialSound(soundId, runtime);
      }
    }
  }

  private reportOfficialRuntimeFailure(error: unknown): void {
    console.warn(
      "[EffectsController] Official openDAW runtime unavailable for this source; using compatibility effects",
      error
    );
    if (this.officialRuntimeWarningReported) {
      return;
    }
    this.officialRuntimeWarningReported = true;
    import("sonner")
      .then(({ toast }) =>
        toast.warning("Some effects run in basic mode in this browser")
      )
      .catch(() => undefined);
  }

  private connectCompatibilityGraph(state: SoundEffectsState): void {
    const { graph, manager } = state;
    if (!(graph && manager?.node && manager.outputNode)) {
      return;
    }
    graph.connectCompatibility(manager.node, manager.outputNode);
  }

  private disconnectCompatibilityGraph(state: SoundEffectsState): void {
    const { graph, manager } = state;
    if (!(graph && manager?.node && manager.outputNode)) {
      return;
    }
    graph.disconnectCompatibility(manager.node, manager.outputNode);
  }

  private disconnectGraph(soundId: string, state: SoundEffectsState): void {
    const { graph } = state;
    if (!graph) {
      return;
    }
    this.disconnectCompatibilityGraph(state);
    graph.disconnect();
    state.graph = null;
    if (this.officialRegisteredSoundIds.has(soundId)) {
      this.releaseOfficialSound(soundId, state);
    }
  }

  private releaseCompatibilityRuntime(state: SoundEffectsState): void {
    this.disconnectCompatibilitySidechain(state);
    this.disconnectCompatibilityGraph(state);
    state.managerPromise = null;
    state.manager?.cleanup();
    state.manager = null;
    state.compatibilitySourceCreated = false;
  }

  private switchBackend(
    soundId: string,
    state: SoundEffectsState,
    backend: EffectsBackend,
    generation: number
  ): void {
    const { graph } = state;
    if (!(graph && state.generation === generation)) {
      return;
    }

    graph.switchTo(backend, () => {
      if (state.graph !== graph || state.generation !== generation) {
        return;
      }
      if (backend !== "compatibility" && backend !== "muted" && state.manager) {
        this.releaseCompatibilityRuntime(state);
      }
      if (
        backend !== "official" &&
        this.officialRegisteredSoundIds.has(soundId)
      ) {
        this.releaseOfficialSound(soundId, state);
        this.registerNonOfficialSource(soundId, state, generation).catch(
          (error: unknown) => {
            if (
              this.states.get(soundId) === state &&
              state.generation === generation
            ) {
              captureError(error, {
                operation: "registerEffectsSidechain",
                surface: "ui",
              });
            }
          }
        );
      }
    });
  }

  private refreshRuntimeSelection(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state?.graph) {
      return;
    }
    const generation = this.advance(state);
    this.selectRuntime(soundId, state, generation)
      .then(() => {
        if (state.generation === generation) {
          state.outcome = this.readyOutcome(state);
        }
      })
      .catch((error: unknown) => {
        if (state.generation === generation) {
          this.switchBackend(soundId, state, "bypass", generation);
          state.outcome = {
            backend: "bypass",
            error: error instanceof Error ? error : new Error(String(error)),
            ready: true,
            status: "failed",
          };
          captureError(error, {
            operation: "selectEffectsRuntime",
            surface: "ui",
          });
        }
      });
  }
}

export type { EffectsControllerOptions };
export { EffectsController };
