import { canUseOfficialOpenDawRuntime } from "../dsp/effects/official-opendaw-mapping.js";
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
import type { EffectsGraphRuntime } from "./effects-graph-runtime.js";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime.js";

type GraphConnection = { destination: AudioNode; source: AudioNode };
type SidechainConnection = { source: AudioNode; target: AudioNode };

type SoundEffectsState = {
  compatibilitySourceCreated: boolean;
  desiredSidechainSoundId: string | null;
  dryWet: number;
  effects: EffectConfig[];
  generation: number;
  graph: GraphConnection | null;
  manager: WorkletManager | null;
  managerPromise: Promise<WorkletManager> | null;
  officialConnected: boolean;
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
  sidechain: null,
});

class EffectsController {
  private officialRuntime: EffectsGraphRuntime | null = null;
  private officialRuntimeUnavailable = false;
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

  add(soundId: string, config: EffectConfig): boolean {
    const state = this.getState(soundId);
    if (!state.manager) {
      return false;
    }

    const plainConfig = toPlainEffectConfig(config);
    state.effects = appendEffectToTree(state.effects, plainConfig);
    if (state.compatibilitySourceCreated) {
      const engineConfig: EngineEffectConfig = convertEffectConfig(plainConfig);
      state.manager.addEffect(
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
    const state = this.getState(soundId);
    if (!state.manager) {
      return false;
    }

    const plainConfig = toPlainEffectConfig(config);
    const rootId = findRootEffectContainer(state.effects, effectId)?.id;
    state.effects = updateEffectInTree(state.effects, effectId, plainConfig);
    const root = rootId ? findEffectInTree(state.effects, rootId) : undefined;
    if (state.compatibilitySourceCreated) {
      state.manager.updateEffect(
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
    if (!state.desiredSidechainSoundId) {
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

    const context = getAudioContext();
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

  async connectGraph(
    soundId: string,
    source: AudioNode,
    destination: AudioNode
  ): Promise<boolean> {
    const manager = await this.getOrCreateWorkletManager(soundId);
    if (!(manager.node && manager.outputNode)) {
      return false;
    }

    const state = this.getState(soundId);
    manager.createStreamSource(soundId);
    if (!state.compatibilitySourceCreated) {
      state.compatibilitySourceCreated = true;
      this.replayCompatibilityState(soundId, state);
    }
    manager.startSource(soundId);
    state.graph = { destination, source };
    const generation = this.advance(state);
    this.connectCompatibilityGraph(state);
    this.refreshSidechains();

    if (
      canUseOfficialOpenDawRuntime(state.effects) &&
      (await this.connectOfficial(soundId, state, generation))
    ) {
      this.disconnectCompatibilityGraph(state);
    } else {
      await this.registerCompatibilitySource(soundId, state, generation);
    }
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
    this.officialRuntime?.disconnectSound(soundId, generation);
    state.officialConnected = false;
    this.disconnectCompatibilityGraph(state);
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
    this.officialRuntime?.disconnectSound(soundId, generation);
    state.officialConnected = false;
  }

  cleanupSound(soundId: string): void {
    const state = this.states.get(soundId);
    if (!state) {
      return;
    }
    const generation = this.advance(state);
    this.disconnectCompatibilitySidechain(state);
    state.managerPromise = null;
    state.manager?.cleanup();
    state.manager = null;
    this.officialRuntime?.deleteSound(soundId, generation);
    this.states.delete(soundId);

    for (const other of this.states.values()) {
      if (other.desiredSidechainSoundId === soundId) {
        this.bindCompatibilitySidechain(other);
      }
    }
  }

  cleanup(): void {
    for (const state of this.states.values()) {
      this.advance(state);
      this.disconnectCompatibilitySidechain(state);
      state.managerPromise = null;
      state.manager?.cleanup();
    }
    this.states.clear();
    this.officialRuntime?.cleanup();
    this.officialRuntime = null;
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
    try {
      const connected = await runtime.connectSound(
        soundId,
        graph.source,
        graph.destination,
        generation
      );
      if (
        !connected ||
        state.generation !== generation ||
        state.graph !== graph ||
        this.officialRuntime !== runtime ||
        !canUseOfficialOpenDawRuntime(state.effects)
      ) {
        return false;
      }

      state.officialConnected = true;
      runtime.setTempo(this.bpm);
      runtime.setSidechainTarget(soundId, state.desiredSidechainSoundId);
      runtime.syncEffects(soundId, state.effects);
      runtime.setDryWet(soundId, state.dryWet);
      await this.registerCompatibilitySources(runtime, soundId);
      return (
        state.generation === generation &&
        state.graph === graph &&
        state.officialConnected
      );
    } catch (error) {
      if (
        state.generation !== generation ||
        state.graph !== graph ||
        this.officialRuntime !== runtime
      ) {
        return false;
      }
      runtime.cleanup();
      this.officialRuntime = null;
      for (const current of this.states.values()) {
        current.officialConnected = false;
      }
      this.connectAllCompatibilityGraphs();
      this.reportOfficialRuntimeFailure(error);
      return false;
    }
  }

  private async registerCompatibilitySources(
    runtime: EffectsGraphRuntime,
    exceptSoundId: string
  ): Promise<void> {
    await Promise.all(
      [...this.states]
        .filter(
          ([soundId, state]) =>
            soundId !== exceptSoundId &&
            !state.officialConnected &&
            state.graph !== null
        )
        .map(([soundId, state]) =>
          runtime.connectSidechainSource(
            soundId,
            state.graph?.source as AudioNode,
            state.generation
          )
        )
    );
    for (const [soundId, state] of this.states) {
      runtime.setSidechainTarget(soundId, state.desiredSidechainSoundId);
    }
  }

  private async registerCompatibilitySource(
    soundId: string,
    state: SoundEffectsState,
    generation: number
  ): Promise<void> {
    const runtime = this.officialRuntime;
    const graph = state.graph;
    if (
      !(runtime && graph) ||
      state.officialConnected ||
      this.states.get(soundId) !== state ||
      state.generation !== generation
    ) {
      return;
    }
    await runtime.connectSidechainSource(soundId, graph.source, generation);
  }

  private reportOfficialRuntimeFailure(error: unknown): void {
    if (this.officialRuntimeUnavailable) {
      return;
    }
    this.officialRuntimeUnavailable = true;
    console.warn(
      "[EffectsController] Official openDAW runtime unavailable; using compatibility effects",
      error
    );
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

  private connectAllCompatibilityGraphs(): void {
    for (const state of this.states.values()) {
      this.connectCompatibilityGraph(state);
    }
  }

  private connectCompatibilityGraph(state: SoundEffectsState): void {
    const { graph, manager } = state;
    if (!(graph && manager?.node && manager.outputNode)) {
      return;
    }
    try {
      graph.source.disconnect(manager.node);
    } catch {
      // Compatibility path was not connected yet.
    }
    try {
      manager.outputNode.disconnect(graph.destination);
    } catch {
      // Compatibility path was not connected yet.
    }
    graph.source.connect(manager.node);
    manager.outputNode.connect(graph.destination);
  }

  private disconnectCompatibilityGraph(state: SoundEffectsState): void {
    const { graph, manager } = state;
    if (!(graph && manager?.node && manager.outputNode)) {
      return;
    }
    try {
      graph.source.disconnect(manager.node);
    } catch {
      // Compatibility path was already disconnected.
    }
    try {
      manager.outputNode.disconnect(graph.destination);
    } catch {
      // Compatibility path was already disconnected.
    }
  }

  private refreshRuntimeSelection(soundId: string): void {
    const state = this.states.get(soundId);
    if (!(state?.graph && state.manager?.node && state.manager.outputNode)) {
      return;
    }
    const generation = this.advance(state);
    this.connectCompatibilityGraph(state);
    if (!canUseOfficialOpenDawRuntime(state.effects)) {
      state.officialConnected = false;
      this.registerCompatibilitySource(soundId, state, generation).catch(
        (error: unknown) =>
          console.warn(
            "[EffectsController] Failed to register sidechain source",
            error
          )
      );
      return;
    }
    this.connectOfficial(soundId, state, generation)
      .then((connected) => {
        if (state.generation !== generation) {
          return;
        }
        if (connected) {
          this.disconnectCompatibilityGraph(state);
        } else {
          state.officialConnected = false;
          this.connectCompatibilityGraph(state);
        }
      })
      .catch((error: unknown) => {
        if (state.generation === generation) {
          state.officialConnected = false;
          this.connectCompatibilityGraph(state);
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
