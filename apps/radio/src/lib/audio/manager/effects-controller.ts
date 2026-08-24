import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  selectEnabledEffects,
} from "../dsp/effects/official-opendaw-mapping.js";
import { clampEffectTempo } from "../dsp/effects/tempo.js";
import type { EffectConfig, EffectType } from "../dsp/effects/types.js";
import {
  appendEffectToTree,
  findEffectInTree,
  findRootEffectContainer,
  removeEffectFromTree,
  reorderEffectTreeChain,
  updateEffectInTree,
} from "../dsp/routing/effect-tree.js";
import {
  type AudioState,
  getAudioContext,
  WorkletManager,
} from "../playback/index.js";
import {
  convertEffectConfig,
  convertPartialEffectConfig,
  type EngineEffectConfig,
  toPlainEffectConfig,
} from "./audio-manager-effects.js";
import { attachWorkletManagerListeners } from "./audio-manager-graph.js";
import type { SoundInstance } from "./audio-manager-types.js";
import {
  type EffectsBackend,
  EffectsBackendRouter,
} from "./effects-backend-router.js";
import type { EffectsGraphRuntime } from "./effects-graph-runtime.js";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime.js";

type SidechainConnection = { source: AudioNode; target: AudioNode };

type SoundEffectsState = {
  compatibilitySourceCreated: boolean;
  desiredSidechainSoundId: string | null;
  dryWet: number;
  effects: EffectConfig[];
  generation: number;
  graph: EffectsBackendRouter | null;
  manager: WorkletManager | null;
  managerPromise: Promise<WorkletManager> | null;
  officialConnected: boolean;
  officialConnectingGeneration: number | null;
  sidechain: SidechainConnection | null;
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
  manager: null,
  managerPromise: null,
  officialConnected: false,
  officialConnectingGeneration: null,
  sidechain: null,
});

class EffectsController {
  private officialRuntime: EffectsGraphRuntime | null = null;
  private officialRuntimeUnavailable = false;
  private officialRuntimeWarningReported = false;
  private readonly officialRegisteredSoundIds = new Set<string>();
  private readonly officialSoundOwners = new Map<string, number>();
  private nextOfficialRuntimeGeneration = 0;
  private bpm = 120;
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
    state.generation = ++this.nextGeneration;
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

  add(soundId: string, config: EffectConfig): boolean {
    if (!this.sounds.has(soundId)) {
      return false;
    }
    const state = this.getState(soundId);
    const plainConfig = toPlainEffectConfig(config);
    state.effects = appendEffectToTree(state.effects, plainConfig);
    if (state.compatibilitySourceCreated) {
      const engineConfig: EngineEffectConfig = convertEffectConfig(plainConfig);
      state.manager?.addEffect(
        soundId,
        plainConfig.id,
        plainConfig.type,
        engineConfig,
        plainConfig.order
      );
    }
    this.refreshRuntimeSelection(soundId);
    return true;
  }

  remove(soundId: string, effectId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    const rootId = findRootEffectContainer(state.effects, effectId)?.id;
    state.effects = removeEffectFromTree(state.effects, effectId);
    const root = rootId ? findEffectInTree(state.effects, rootId) : undefined;
    if (root && state.compatibilitySourceCreated) {
      state.manager?.updateEffect(soundId, root.id, convertEffectConfig(root));
    } else if (state.compatibilitySourceCreated) {
      state.manager?.removeEffect(soundId, effectId);
    }
    this.refreshRuntimeSelection(soundId);
  }

  update(
    soundId: string,
    effectId: string,
    type: EffectType,
    config: Partial<EffectConfig>
  ): boolean {
    if (!this.sounds.has(soundId)) {
      return false;
    }
    const state = this.getState(soundId);
    const plainConfig = toPlainEffectConfig(config);
    const rootId = findRootEffectContainer(state.effects, effectId)?.id;
    state.effects = updateEffectInTree(state.effects, effectId, plainConfig);
    const root = rootId ? findEffectInTree(state.effects, rootId) : undefined;
    if (state.compatibilitySourceCreated) {
      state.manager?.updateEffect(
        soundId,
        root?.id ?? effectId,
        root
          ? convertEffectConfig(root)
          : convertPartialEffectConfig(type, plainConfig)
      );
    }
    this.refreshRuntimeSelection(soundId);
    return true;
  }

  reorder(soundId: string, effectIds: string[]): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    if (state.compatibilitySourceCreated) {
      state.manager?.reorderEffects(soundId, effectIds);
    }
    state.effects = reorderEffectTreeChain(state.effects, effectIds);
    this.refreshRuntimeSelection(soundId);
  }

  setDryWet(soundId: string, value: number): void {
    const state = this.getState(soundId);
    state.dryWet = Math.max(0, Math.min(1, value));
    if (state.compatibilitySourceCreated) {
      state.manager?.setEffectsDryWet(soundId, state.dryWet);
    }
    this.officialRuntime?.setDryWet(soundId, state.dryWet);
    this.refreshRuntimeSelection(soundId);
  }

  setTempo(soundId: string, bpm: number): void {
    this.bpm = clampEffectTempo(bpm);
    const state = this.states.get(soundId);
    if (state?.compatibilitySourceCreated) {
      state.manager?.setTempo(soundId, this.bpm);
    }
    this.officialRuntime?.setTempo(this.bpm);
  }

  setSidechain(soundId: string, sidechainSoundId: string | null): boolean {
    const state = this.getState(soundId);
    state.desiredSidechainSoundId = sidechainSoundId;
    this.officialRuntime?.setSidechainTarget(soundId, sidechainSoundId);
    this.pruneOfficialSidechainSources();
    if (sidechainSoundId) {
      const targetState = this.states.get(sidechainSoundId);
      if (targetState) {
        this.registerNonOfficialSource(
          sidechainSoundId,
          targetState,
          targetState.generation
        ).catch((error: unknown) =>
          console.warn(
            "[EffectsController] Failed to register sidechain source",
            error
          )
        );
      }
    }
    return this.bindCompatibilitySidechain(state);
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

  getWorkletManager(soundId: string): WorkletManager | null {
    return this.states.get(soundId)?.manager ?? null;
  }

  async getOrCreateWorkletManager(soundId: string): Promise<WorkletManager> {
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
        wm: manager,
        sounds: this.sounds,
        notifyListeners: this.notifyListeners,
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

  async prepare(soundId: string): Promise<boolean> {
    const state = this.getState(soundId);
    if (
      !this.shouldProcess(state) ||
      canUseOfficialOpenDawRuntime(state.effects)
    ) {
      return true;
    }
    const manager = await this.getOrCreateWorkletManager(soundId);
    return manager.isReady;
  }

  async connectGraph(
    soundId: string,
    source: AudioNode,
    destination: AudioNode
  ): Promise<boolean> {
    const state = this.getState(soundId);
    this.disconnectGraph(soundId, state);

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
        (error: unknown) =>
          console.warn(
            "[EffectsController] Failed to re-register sidechain source",
            error
          )
      );
      return true;
    }

    await this.selectRuntime(soundId, state, generation);
    // Runtime selection can be superseded by an effect edit while it awaits a
    // worklet. The stable router is still valid and the newer generation owns
    // the eventual backend; returning false here would make AudioManager add a
    // second dry edge alongside this graph.
    return state.graph?.source === source;
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
    const manager = state.manager;
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
    manager.setTempo(soundId, this.bpm);
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

  private releaseOfficialAttemptIfOwned(
    soundId: string,
    state: SoundEffectsState,
    runtime: EffectsGraphRuntime,
    runtimeGeneration: number
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
      this.releaseOfficialAttemptIfOwned(
        soundId,
        state,
        runtime,
        runtimeGeneration
      );
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
    const graph = state.graph;
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
      const connected = await runtime.connectSound(
        soundId,
        graph.source,
        graph.officialGain,
        runtimeGeneration
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
          this.releaseOfficialAttemptIfOwned(
            soundId,
            state,
            runtime,
            runtimeGeneration
          );
        }
        return false;
      }

      this.officialRegisteredSoundIds.add(soundId);
      runtime.setTempo(this.bpm);
      runtime.setSidechainTarget(soundId, state.desiredSidechainSoundId);
      runtime.syncEffects(soundId, selectEnabledEffects(state.effects));
      runtime.setDryWet(soundId, state.dryWet);
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
    const graph = state.graph;
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
      runtimeGeneration
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
        toast.warning("openDAW effects are using compatibility mode", {
          description:
            error instanceof Error
              ? error.message
              : "The browser audio engine could not be initialized.",
        })
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
    const graph = state.graph;
    if (!graph) {
      return;
    }
    this.disconnectCompatibilityGraph(state);
    graph.disconnect();
    state.graph = null;
    if (this.officialRegisteredSoundIds.has(soundId)) {
      this.deleteOfficialSound(soundId);
      state.officialConnected = false;
      this.pruneOfficialSidechainSources();
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
    const graph = state.graph;
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
        this.deleteOfficialSound(soundId);
        state.officialConnected = false;
        this.pruneOfficialSidechainSources();
        this.registerNonOfficialSource(soundId, state, generation).catch(
          (error: unknown) =>
            console.warn(
              "[EffectsController] Failed to register sidechain source",
              error
            )
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
    this.selectRuntime(soundId, state, generation).catch((error: unknown) => {
      if (state.generation === generation) {
        this.switchBackend(soundId, state, "bypass", generation);
      }
      console.warn(
        "[EffectsController] Failed to select effects runtime",
        error
      );
    });
  }
}

export type { EffectsControllerOptions };
export { EffectsController };
