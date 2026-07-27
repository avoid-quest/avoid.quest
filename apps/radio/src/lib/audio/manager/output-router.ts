import { getAudioContext } from "../playback/index.js";
import { safeDisconnect } from "../utils.js";
import {
  createMasterGraphNodes,
  type MasterGraphNodes,
} from "./audio-manager-graph.js";
import {
  MAX_MAIN_DELAY_MS,
  MAX_MAIN_DELAY_SECONDS,
} from "./audio-manager-types.js";

class OutputRouter {
  private masterGraph: MasterGraphNodes | null = null;
  private mainDelayMs = 0;

  get mainDelayNode(): DelayNode | null {
    return this.masterGraph?.mainDelayNode ?? null;
  }

  initializeMasterGraph(context: AudioContext): MasterGraphNodes {
    const currentMainDelayMs = this.mainDelayMs;
    this.disconnectMasterGraph();
    this.masterGraph = createMasterGraphNodes(context, MAX_MAIN_DELAY_SECONDS);
    this.mainDelayMs = currentMainDelayMs;
    this.setMainDelay(currentMainDelayMs);
    return this.masterGraph;
  }

  getMainDelay(): number {
    return this.mainDelayMs;
  }

  setMainDelay(ms: number): void {
    const clampedMs = Math.max(0, Math.min(MAX_MAIN_DELAY_MS, ms));
    this.mainDelayMs = clampedMs;

    if (!this.masterGraph) {
      return;
    }

    const context = getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const seconds = clampedMs / 1000;
    this.masterGraph.mainDelayNode.delayTime.setTargetAtTime(
      seconds,
      now,
      0.02
    );
  }

  cleanup(): void {
    this.disconnectMasterGraph();
    this.mainDelayMs = 0;
  }

  private disconnectMasterGraph(): void {
    if (this.masterGraph?.mainDelayNode) {
      safeDisconnect(this.masterGraph.mainDelayNode, "AudioManager.cleanup");
    }

    this.masterGraph = null;
  }
}

export { OutputRouter };
