import { getOutputRouting } from "../../output-routing.js";
import type { MasterGraphNodes } from "./audio-manager-graph.js";

class OutputRouter {
  private context: AudioContext | null = null;

  get mainDelayNode(): DelayNode | null {
    if (!this.context) {
      return null;
    }
    return getOutputRouting().getMainOutput(this.context) as DelayNode;
  }

  initializeMasterGraph(context: AudioContext): MasterGraphNodes {
    this.context = context;
    const routing = getOutputRouting();
    const mainDelayNode = routing.getMainOutput(context) as DelayNode;
    routing.replaceContext(context).catch(() => undefined);
    return {
      mainDelayNode,
    };
  }

  getMainDelay(): number {
    return getOutputRouting().getSnapshot().settings.mainDelayMs;
  }

  setMainDelay(ms: number): void {
    getOutputRouting()
      .applySettings({ mainDelayMs: ms })
      .catch(() => undefined);
  }

  cleanup(): void {
    this.context = null;
    getOutputRouting().cleanup();
  }
}

export { OutputRouter };
