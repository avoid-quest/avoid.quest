import { canUseOfficialOpenDawRuntime } from "../dsp/effects/official-opendaw-mapping.js";
import type { EffectConfig, EffectType } from "../dsp/effects/types.js";
import { updateEffectInTree } from "../dsp/routing/effect-tree.js";
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
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime.js";

type EffectsControllerOptions = {
  workletProcessorUrl: () => string;
  sounds: Map<string, SoundInstance>;
  notifyListeners: (soundId: string, state: AudioState) => void;
};

class EffectsController {
  private officialRuntime: OfficialOpenDawRuntime | null = null;
  private officialRuntimeUnavailable = false;
  private bpm = 120;
  private readonly effectConfigs = new Map<string, EffectConfig[]>();
  private readonly effectsDryWet = new Map<string, number>();
  private readonly graphConnections = new Map<
    string,
    { destination: AudioNode; source: AudioNode }
  >();
  private readonly workletManagers = new Map<string, WorkletManager>();
  private readonly workletManagerPromises = new Map<
    string,
    Promise<WorkletManager>
  >();
  private readonly workletProcessorUrl: () => string;
  private readonly sidechainConnections = new Map<
    string,
    { source: AudioNode; target: AudioNode }
  >();
  private readonly desiredSidechains = new Map<string, string>();
  private readonly sounds: Map<string, SoundInstance>;
  private readonly notifyListeners: (
    soundId: string,
    state: AudioState
  ) => void;

  constructor({
    workletProcessorUrl,
    sounds,
    notifyListeners,
  }: EffectsControllerOptions) {
    this.workletProcessorUrl = workletProcessorUrl;
    this.sounds = sounds;
    this.notifyListeners = notifyListeners;
  }

  add(soundId: string, config: EffectConfig): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const plainConfig = toPlainEffectConfig(config);
    const effects = [...(this.effectConfigs.get(soundId) ?? []), plainConfig]
      .sort((left, right) => left.order - right.order)
      .map((effect, order) => ({ ...effect, order }) as EffectConfig);
    this.effectConfigs.set(soundId, effects);
    const engineConfig: EngineEffectConfig = convertEffectConfig(plainConfig);
    wm.addEffect(
      soundId,
      plainConfig.id,
      plainConfig.type,
      engineConfig,
      plainConfig.order
    );
    this.refreshRuntimeSelection(soundId);
    return true;
  }

  remove(soundId: string, effectId: string): void {
    this.workletManagers.get(soundId)?.removeEffect(soundId, effectId);
    const remove = (effects: readonly EffectConfig[]): EffectConfig[] => {
      const remaining: EffectConfig[] = [];
      for (const effect of effects) {
        if (effect.id === effectId) {
          continue;
        }
        if (
          effect.type === "fxComposite" ||
          effect.type === "stereoSplit" ||
          effect.type === "frequencySplit"
        ) {
          remaining.push({
            ...effect,
            chains: effect.chains.map((chain) => ({
              ...chain,
              effects: remove(chain.effects),
            })),
          });
          continue;
        }
        remaining.push(effect);
      }
      return remaining;
    };
    this.effectConfigs.set(
      soundId,
      remove(this.effectConfigs.get(soundId) ?? [])
    );
    this.refreshRuntimeSelection(soundId);
  }

  update(
    soundId: string,
    effectId: string,
    type: EffectType,
    config: Partial<EffectConfig>
  ): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const plainConfig = toPlainEffectConfig(config);
    const engineConfig: EngineEffectConfig = convertPartialEffectConfig(
      type,
      plainConfig
    );
    wm.updateEffect(soundId, effectId, engineConfig);
    this.effectConfigs.set(
      soundId,
      updateEffectInTree(
        this.effectConfigs.get(soundId) ?? [],
        effectId,
        plainConfig
      )
    );
    this.refreshRuntimeSelection(soundId);
    return true;
  }

  reorder(soundId: string, effectIds: string[]): void {
    this.workletManagers.get(soundId)?.reorderEffects(soundId, effectIds);
    const ranks = new Map(effectIds.map((id, index) => [id, index]));
    this.effectConfigs.set(
      soundId,
      (this.effectConfigs.get(soundId) ?? [])
        .slice()
        .sort(
          (left, right) =>
            (ranks.get(left.id) ?? left.order) -
            (ranks.get(right.id) ?? right.order)
        )
        .map((effect, order) => ({ ...effect, order }) as EffectConfig)
    );
    this.refreshRuntimeSelection(soundId);
  }

  setDryWet(soundId: string, value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value));
    this.effectsDryWet.set(soundId, clampedValue);
    this.workletManagers.get(soundId)?.setEffectsDryWet(soundId, clampedValue);
    this.officialRuntime?.setDryWet(soundId, clampedValue);
  }

  setTempo(soundId: string, bpm: number): void {
    this.bpm = Math.max(30, Math.min(1000, bpm));
    this.workletManagers
      .get(soundId)
      ?.setTempo(soundId, Math.max(20, Math.min(400, bpm)));
    this.officialRuntime?.setTempo(this.bpm);
  }

  setSidechain(soundId: string, sidechainSoundId: string | null): boolean {
    const existing = this.sidechainConnections.get(soundId);
    if (existing) {
      try {
        existing.source.disconnect(existing.target, 0, 1);
      } catch {
        // The source may already have been disconnected during graph cleanup.
      }
      this.sidechainConnections.delete(soundId);
    }
    if (!sidechainSoundId) {
      this.desiredSidechains.delete(soundId);
      this.officialRuntime?.setSidechainTarget(soundId, null);
      return true;
    }
    this.desiredSidechains.set(soundId, sidechainSoundId);
    this.officialRuntime?.setSidechainTarget(soundId, sidechainSoundId);
    const source = this.sounds.get(sidechainSoundId)?.nodes?.filter;
    const target = this.workletManagers.get(soundId)?.node;
    if (!(source && target)) {
      return false;
    }
    source.connect(target, 0, 1);
    this.sidechainConnections.set(soundId, { source, target });
    return true;
  }

  private refreshSidechains(): void {
    for (const [soundId, sidechainSoundId] of this.desiredSidechains) {
      this.setSidechain(soundId, sidechainSoundId);
    }
  }

  getWorkletManager(soundId: string): WorkletManager | null {
    return this.workletManagers.get(soundId) ?? null;
  }

  async getOrCreateWorkletManager(soundId: string): Promise<WorkletManager> {
    const existingManager = this.workletManagers.get(soundId);
    if (existingManager) {
      return existingManager;
    }

    const existingPromise = this.workletManagerPromises.get(soundId);
    if (existingPromise) {
      return existingPromise;
    }

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    const manager = new WorkletManager(context, this.workletProcessorUrl());
    let managerPromise: Promise<WorkletManager>;
    managerPromise = manager.init().then(() => {
      if (this.workletManagerPromises.get(soundId) !== managerPromise) {
        manager.cleanup();
        throw new Error(
          `Effect runtime initialization canceled for ${soundId}`
        );
      }

      this.workletManagers.set(soundId, manager);
      attachWorkletManagerListeners({
        wm: manager,
        sounds: this.sounds,
        notifyListeners: this.notifyListeners,
      });
      this.refreshSidechains();
      return manager;
    });
    this.workletManagerPromises.set(soundId, managerPromise);

    try {
      return await managerPromise;
    } finally {
      if (this.workletManagerPromises.get(soundId) === managerPromise) {
        this.workletManagerPromises.delete(soundId);
      }
    }
  }

  /**
   * Connect the live source through the selected effects runtime.
   *
   * Keeping this ownership in EffectsController is the migration seam for the
   * shared official openDAW monitoring engine. The compatibility path remains
   * the default until persisted effect configs have complete BoxGraph adapters.
   */
  async connectGraph(
    soundId: string,
    source: AudioNode,
    destination: AudioNode
  ): Promise<boolean> {
    const manager = await this.getOrCreateWorkletManager(soundId);
    manager.createStreamSource(soundId);
    manager.startSource(soundId);
    if (!(manager.node && manager.outputNode)) {
      return false;
    }
    this.graphConnections.set(soundId, { destination, source });
    this.connectCompatibilityGraph(soundId);
    if (
      canUseOfficialOpenDawRuntime(this.effectConfigs.get(soundId) ?? []) &&
      (await this.connectOfficial(soundId, source, destination))
    ) {
      this.disconnectCompatibilityGraph(soundId);
      return true;
    }
    return true;
  }

  pauseSource(soundId: string): void {
    this.workletManagers.get(soundId)?.pauseSource(soundId);
  }

  resumeSource(soundId: string): void {
    this.workletManagers.get(soundId)?.resumeSource(soundId);
  }

  stopSource(soundId: string): void {
    this.workletManagers.get(soundId)?.stopSource(soundId);
  }

  cleanupSound(soundId: string): void {
    this.setSidechain(soundId, null);
    for (const [targetId, sidechainSoundId] of this.desiredSidechains) {
      if (sidechainSoundId === soundId) {
        this.setSidechain(targetId, null);
      }
    }
    const managerPromise = this.workletManagerPromises.get(soundId);
    if (managerPromise) {
      this.workletManagerPromises.delete(soundId);
      managerPromise.catch(() => undefined);
    }

    const wm = this.workletManagers.get(soundId);
    if (wm) {
      wm.cleanup();
      this.workletManagers.delete(soundId);
    }
    this.officialRuntime?.deleteSound(soundId);
    this.graphConnections.delete(soundId);
    this.effectConfigs.delete(soundId);
    this.effectsDryWet.delete(soundId);
  }

  cleanup(): void {
    for (const soundId of [...this.sidechainConnections.keys()]) {
      this.setSidechain(soundId, null);
    }
    for (const [soundId, managerPromise] of this.workletManagerPromises) {
      this.workletManagerPromises.delete(soundId);
      managerPromise.catch(() => undefined);
    }
    for (const wm of this.workletManagers.values()) {
      wm.cleanup();
    }
    this.workletManagers.clear();
    this.officialRuntime?.cleanup();
    this.officialRuntime = null;
    this.graphConnections.clear();
    this.effectConfigs.clear();
    this.effectsDryWet.clear();
  }

  private async connectOfficial(
    soundId: string,
    source: AudioNode,
    destination: AudioNode
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
    let effects = this.effectConfigs.get(soundId) ?? [];
    if (!canUseOfficialOpenDawRuntime(effects)) {
      return false;
    }
    try {
      this.officialRuntime ??= new OfficialOpenDawRuntime(
        source.context as AudioContext
      );
      await this.officialRuntime.connectSound(soundId, source, destination);
      effects = this.effectConfigs.get(soundId) ?? [];
      if (!canUseOfficialOpenDawRuntime(effects)) {
        this.officialRuntime.disconnectSound(soundId);
        return false;
      }
      this.officialRuntime.setTempo(this.bpm);
      this.officialRuntime.setSidechainTarget(
        soundId,
        this.desiredSidechains.get(soundId) ?? null
      );
      this.officialRuntime.syncEffects(soundId, effects);
      this.officialRuntime.setDryWet(
        soundId,
        this.effectsDryWet.get(soundId) ?? 1
      );
      return true;
    } catch (error) {
      this.officialRuntime?.cleanup();
      this.officialRuntime = null;
      this.connectAllCompatibilityGraphs();
      this.reportOfficialRuntimeFailure(error);
      return false;
    }
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
    for (const soundId of this.graphConnections.keys()) {
      const manager = this.workletManagers.get(soundId);
      if (!(manager?.node && manager.outputNode)) {
        continue;
      }
      this.connectCompatibilityGraph(soundId);
    }
  }

  private connectCompatibilityGraph(soundId: string): void {
    const connection = this.graphConnections.get(soundId);
    const manager = this.workletManagers.get(soundId);
    if (!(connection && manager?.node && manager.outputNode)) {
      return;
    }
    try {
      connection.source.disconnect(manager.node);
    } catch {
      // Compatibility path was not connected yet.
    }
    try {
      manager.outputNode.disconnect(connection.destination);
    } catch {
      // Compatibility path was not connected yet.
    }
    connection.source.connect(manager.node);
    manager.outputNode.connect(connection.destination);
  }

  private disconnectCompatibilityGraph(soundId: string): void {
    const connection = this.graphConnections.get(soundId);
    const manager = this.workletManagers.get(soundId);
    if (!(connection && manager?.node && manager.outputNode)) {
      return;
    }
    try {
      connection.source.disconnect(manager.node);
    } catch {
      // Compatibility path was already disconnected.
    }
    try {
      manager.outputNode.disconnect(connection.destination);
    } catch {
      // Compatibility path was already disconnected.
    }
  }

  private refreshRuntimeSelection(soundId: string): void {
    const connection = this.graphConnections.get(soundId);
    const manager = this.workletManagers.get(soundId);
    if (!(connection && manager?.node && manager.outputNode)) {
      return;
    }
    const effects = this.effectConfigs.get(soundId) ?? [];
    if (!canUseOfficialOpenDawRuntime(effects)) {
      this.officialRuntime?.disconnectSound(soundId);
      this.connectCompatibilityGraph(soundId);
      return;
    }
    this.connectCompatibilityGraph(soundId);
    this.connectOfficial(soundId, connection.source, connection.destination)
      .then((connected) => {
        if (connected) {
          this.disconnectCompatibilityGraph(soundId);
        } else {
          this.connectCompatibilityGraph(soundId);
        }
      })
      .catch((error: unknown) => {
        this.connectCompatibilityGraph(soundId);
        console.warn(
          "[EffectsController] Failed to select effects runtime",
          error
        );
      });
  }
}

export type { EffectsControllerOptions };
export { EffectsController };
