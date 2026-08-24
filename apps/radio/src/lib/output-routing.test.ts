import { describe, expect, test } from "bun:test";
import {
  createOutputRouting,
  type OutputBrowserAdapter,
  type OutputBrowserGraph,
  type OutputRoutingSettings,
  type OutputSettingsAdapter,
} from "./output-routing";

type TestNode = AudioNode & { id: string };

function node(id: string, context: AudioContext): TestNode {
  return { context, id } as unknown as TestNode;
}

class InMemoryGraph implements OutputBrowserGraph {
  readonly context: AudioContext;
  readonly cueConnections = new Set<AudioNode>();
  readonly mainConnections = new Set<AudioNode>();
  cueDelayMs = 0;
  disposed = false;
  headphoneVolume = 1;
  mainDelayMs = 0;
  readonly mainOutput: AudioNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.mainOutput = node("main-output", context);
  }

  connectCue(source: AudioNode): void {
    this.cueConnections.add(source);
  }

  connectMain(source: AudioNode): void {
    this.mainConnections.add(source);
  }

  disconnectCue(source: AudioNode): void {
    this.cueConnections.delete(source);
  }

  disconnectMain(source: AudioNode): void {
    this.mainConnections.delete(source);
  }

  dispose(): void {
    this.disposed = true;
    this.cueConnections.clear();
    this.mainConnections.clear();
  }

  setCueDelay(delayMs: number): void {
    this.cueDelayMs = delayMs;
  }

  setHeadphoneVolume(volume: number): void {
    this.headphoneVolume = volume;
  }

  setMainDelay(delayMs: number): void {
    this.mainDelayMs = delayMs;
  }
}

class InMemoryBrowserAdapter implements OutputBrowserAdapter {
  readonly cueSinkDeferrals: Array<{
    promise: Promise<void>;
    resolve(): void;
  }> = [];
  readonly cueSinkCreations: string[] = [];
  readonly cueSinkDisposals: string[] = [];
  readonly graphs: InMemoryGraph[] = [];
  readonly mainSinkChanges: string[] = [];
  readonly mainSinkErrors = new Map<string, Error>();
  readonly mainSinkDeferrals: Array<{
    promise: Promise<void>;
    resolve(): void;
  }> = [];
  context = { id: "context-1" } as unknown as AudioContext;
  cueSinkError: Error | null = null;
  supported = true;

  async createCueSink(_graph: OutputBrowserGraph, deviceId: string) {
    this.cueSinkCreations.push(deviceId);
    if (this.cueSinkError) {
      throw this.cueSinkError;
    }
    await this.cueSinkDeferrals.shift()?.promise;
    return {
      deviceId,
      dispose: () => {
        this.cueSinkDisposals.push(deviceId);
      },
    };
  }

  createGraph(context: AudioContext): OutputBrowserGraph {
    const graph = new InMemoryGraph(context);
    this.graphs.push(graph);
    return graph;
  }

  getContext(): AudioContext {
    return this.context;
  }

  isSinkSelectionSupported(): boolean {
    return this.supported;
  }

  deferNextMainSink() {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const deferral = {
      promise,
      resolve: resolvePromise,
    };
    this.mainSinkDeferrals.push(deferral);
    return deferral;
  }

  deferNextCueSink() {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const deferral = {
      promise,
      resolve: resolvePromise,
    };
    this.cueSinkDeferrals.push(deferral);
    return deferral;
  }

  setMainSink(_context: AudioContext, deviceId: string): Promise<void> {
    this.mainSinkChanges.push(deviceId);
    const error = this.mainSinkErrors.get(deviceId);
    if (error) {
      return Promise.reject(error);
    }
    return this.mainSinkDeferrals.shift()?.promise ?? Promise.resolve();
  }
}

class InMemorySettingsAdapter implements OutputSettingsAdapter {
  private settings: OutputRoutingSettings;
  readonly writes: OutputRoutingSettings[] = [];

  constructor(
    settings: OutputRoutingSettings = {
      cueDelayMs: 0,
      cueOutputId: null,
      mainDelayMs: 0,
      mainOutputId: "default",
    }
  ) {
    this.settings = settings;
  }

  read(): OutputRoutingSettings {
    return { ...this.settings };
  }

  write(settings: OutputRoutingSettings): void {
    this.settings = { ...settings };
    this.writes.push({ ...settings });
  }
}

function setup(
  settings?: OutputRoutingSettings,
  onDeckCueChange?: (deckId: string, enabled: boolean) => void
) {
  const browser = new InMemoryBrowserAdapter();
  const persistence = new InMemorySettingsAdapter(settings);
  const routing = createOutputRouting({
    browser,
    onDeckCueChange,
    settings: persistence,
  });
  return { browser, persistence, routing };
}

describe("OutputRouting", () => {
  test("serializes overlapping settings transactions", async () => {
    const { browser, persistence, routing } = setup();
    const firstSink = browser.deferNextMainSink();
    const secondSink = browser.deferNextMainSink();

    const first = routing.applySettings({ mainOutputId: "speakers" });
    const second = routing.applySettings({ mainOutputId: "studio" });

    expect(browser.mainSinkChanges).toEqual(["speakers"]);
    firstSink.resolve();
    await first;
    secondSink.resolve();
    await second;

    expect(browser.mainSinkChanges).toEqual(["speakers", "studio"]);
    expect(persistence.read().mainOutputId).toBe("studio");
    expect(persistence.writes.map((settings) => settings.mainOutputId)).toEqual(
      ["speakers", "studio"]
    );
  });

  test("continues queued settings transactions after a failure", async () => {
    const { browser, persistence, routing } = setup();
    browser.mainSinkErrors.set("broken", new Error("main sink failed"));

    const failed = routing.applySettings({ mainOutputId: "broken" });
    const recovered = routing.applySettings({ mainOutputId: "studio" });

    await expect(failed).rejects.toThrow("main sink failed");
    await expect(recovered).resolves.toMatchObject({
      settings: { mainOutputId: "studio" },
    });
    expect(browser.mainSinkChanges).toEqual(["broken", "default", "studio"]);
    expect(persistence.writes.map((settings) => settings.mainOutputId)).toEqual(
      ["studio"]
    );
  });

  test("applies main and CUE settings as one transaction", async () => {
    const { browser, persistence, routing } = setup();

    const snapshot = await routing.applySettings({
      cueDelayMs: 35,
      cueOutputId: "headphones",
      mainDelayMs: 120,
      mainOutputId: "speakers",
    });

    expect(snapshot.settings).toEqual({
      cueDelayMs: 35,
      cueOutputId: "headphones",
      mainDelayMs: 120,
      mainOutputId: "speakers",
    });
    expect(browser.mainSinkChanges).toEqual(["speakers"]);
    expect(browser.cueSinkCreations).toEqual(["headphones"]);
    expect(browser.graphs[0]?.mainDelayMs).toBe(120);
    expect(browser.graphs[0]?.cueDelayMs).toBe(35);
    expect(persistence.writes).toEqual([snapshot.settings]);
  });

  test("applies persisted main settings without staging an invalid CUE sink", async () => {
    const { browser, persistence, routing } = setup({
      cueDelayMs: 25,
      cueOutputId: "invalid-headphones",
      mainDelayMs: 80,
      mainOutputId: "speakers",
    });
    browser.cueSinkError = new Error("invalid CUE sink");

    const snapshot = await routing.applyMainSettings();

    expect(snapshot.cueOutputCleared).toBe(false);
    expect(snapshot.settings.mainOutputId).toBe("speakers");
    expect(snapshot.settings.mainDelayMs).toBe(80);
    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(snapshot.cueActive).toBe(false);
    expect(browser.mainSinkChanges).toEqual(["speakers"]);
    expect(browser.cueSinkCreations).toEqual([]);
    expect(persistence.read().cueOutputId).toBe("invalid-headphones");
    expect(persistence.writes).toEqual([]);
  });

  test("main-only settings atomically clear a colliding CUE output", async () => {
    const { browser, persistence, routing } = setup();
    await routing.applySettings({
      cueOutputId: "headphones",
      mainOutputId: "speakers",
    });
    const registration = routing.registerCueDeck(
      "deck-a",
      node("cue", browser.context),
      true
    );

    const snapshot = await routing.applyMainSettings({
      mainOutputId: "headphones",
    });

    expect(snapshot.cueOutputCleared).toBe(true);
    expect(snapshot.settings.mainOutputId).toBe("headphones");
    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(snapshot.cueActive).toBe(false);
    expect(registration.enabled).toBe(false);
    expect(browser.cueSinkDisposals).toEqual(["headphones"]);
    expect(persistence.read().cueOutputId).toBeNull();
  });

  test("main-only settings clear a persisted collision without staging CUE", async () => {
    const { browser, persistence, routing } = setup({
      cueDelayMs: 0,
      cueOutputId: "headphones",
      mainDelayMs: 0,
      mainOutputId: "speakers",
    });

    const snapshot = await routing.applyMainSettings({
      mainOutputId: "headphones",
    });

    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(snapshot.cueActive).toBe(false);
    expect(browser.cueSinkCreations).toEqual([]);
    expect(browser.cueSinkDisposals).toEqual([]);
    expect(persistence.read().cueOutputId).toBeNull();
  });

  test("replays main-only settings after a synchronous graph replacement", async () => {
    const { browser, persistence, routing } = setup({
      cueDelayMs: 25,
      cueOutputId: "invalid-headphones",
      mainDelayMs: 80,
      mainOutputId: "speakers",
    });
    const firstSink = browser.deferNextMainSink();
    const replaySink = browser.deferNextMainSink();
    const applying = routing.applyMainSettings();

    browser.context = { id: "context-2" } as unknown as AudioContext;
    routing.getMainOutput(browser.context);
    firstSink.resolve();
    replaySink.resolve();
    await applying;

    expect(browser.graphs[1]?.mainDelayMs).toBe(80);
    expect(browser.mainSinkChanges).toEqual(["speakers", "speakers"]);
    expect(browser.cueSinkCreations).toEqual([]);
    expect(persistence.writes).toEqual([]);
  });

  test("main-only settings preserve CUE release before a later restore", async () => {
    const { browser, persistence, routing } = setup();
    await routing.applySettings({
      cueOutputId: "headphones",
      mainOutputId: "speakers",
    });
    browser.mainSinkChanges.length = 0;
    const deferredSink = browser.deferNextMainSink();
    const applyingMain = routing.applyMainSettings({
      mainOutputId: "studio",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.mainSinkChanges).toEqual(["studio"]);
    routing.releaseCue();
    deferredSink.resolve();
    const mainSnapshot = await applyingMain;

    expect(mainSnapshot.settings.mainOutputId).toBe("studio");
    expect(mainSnapshot.settings.cueOutputId).toBeNull();
    expect(mainSnapshot.cueActive).toBe(false);
    expect(persistence.read()).toMatchObject({
      cueOutputId: "headphones",
      mainOutputId: "studio",
    });

    const restored = await routing.applySettings();

    expect(restored.settings.cueOutputId).toBe("headphones");
    expect(restored.cueActive).toBe(true);
    expect(browser.cueSinkCreations).toEqual(["headphones", "headphones"]);
  });

  test("rolls back main output when CUE application fails", async () => {
    const { browser, persistence, routing } = setup();
    await routing.applySettings({
      cueDelayMs: 15,
      cueOutputId: "old-headphones",
      mainDelayMs: 40,
      mainOutputId: "old-speakers",
    });
    browser.mainSinkChanges.length = 0;
    browser.cueSinkError = new Error("CUE sink failed");

    await expect(
      routing.applySettings({
        cueDelayMs: 25,
        cueOutputId: "new-headphones",
        mainDelayMs: 70,
        mainOutputId: "new-speakers",
      })
    ).rejects.toThrow("CUE sink failed");

    expect(browser.mainSinkChanges).toEqual(["new-speakers", "old-speakers"]);
    expect(browser.graphs[0]?.mainDelayMs).toBe(40);
    expect(browser.graphs[0]?.cueDelayMs).toBe(15);
    expect(browser.cueSinkDisposals).toEqual([]);
    expect(persistence.writes).toHaveLength(1);
    expect(persistence.read()).toEqual({
      cueDelayMs: 15,
      cueOutputId: "old-headphones",
      mainDelayMs: 40,
      mainOutputId: "old-speakers",
    });
  });

  test("rejects custom sinks when selection is unsupported but keeps defaults", async () => {
    const { browser, persistence, routing } = setup();
    browser.supported = false;

    await expect(
      routing.applySettings({ mainOutputId: "speakers" })
    ).rejects.toThrow("Output device selection is not supported");
    expect(browser.mainSinkChanges).toEqual([]);
    expect(persistence.writes).toEqual([]);

    const snapshot = await routing.applySettings({
      cueOutputId: null,
      mainOutputId: "default",
    });

    expect(snapshot.settings.mainOutputId).toBe("default");
    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(snapshot.sinkSelectionSupported).toBe(false);
    expect(browser.mainSinkChanges).toEqual([]);
    expect(browser.cueSinkCreations).toEqual([]);
  });

  test("normalizes delays before applying and persisting them", async () => {
    const { browser, persistence, routing } = setup();

    const snapshot = await routing.applySettings({
      cueDelayMs: -10,
      mainDelayMs: 900,
    });

    expect(snapshot.settings.cueDelayMs).toBe(0);
    expect(snapshot.settings.mainDelayMs).toBe(500);
    expect(browser.graphs[0]?.cueDelayMs).toBe(0);
    expect(browser.graphs[0]?.mainDelayMs).toBe(500);
    expect(persistence.read()).toEqual(snapshot.settings);
  });

  test("persists normalized output collisions when runtime is unchanged", async () => {
    const { persistence, routing } = setup({
      cueDelayMs: 0,
      cueOutputId: "default",
      mainDelayMs: 0,
      mainOutputId: "default",
    });

    const snapshot = await routing.applySettings();

    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(persistence.read()).toEqual(snapshot.settings);
    expect(persistence.writes).toHaveLength(1);
  });

  test("applies delay-only settings before returning the transaction promise", async () => {
    const { persistence, routing } = setup();

    const transaction = routing.applySettings({ mainDelayMs: 140 });

    expect(persistence.read().mainDelayMs).toBe(140);
    await transaction;
  });

  test("replaces an enabled CUE Deck tap without duplicating connections", async () => {
    const { browser, routing } = setup();
    await routing.applySettings({ cueOutputId: "headphones" });
    const firstTap = node("first", browser.context);
    const secondTap = node("second", browser.context);
    const registration = routing.registerCueDeck("deck-a", firstTap, true);

    registration.replaceTap(secondTap);
    registration.replaceTap(secondTap);

    expect(browser.graphs[0]?.cueConnections).toEqual(new Set([secondTap]));
    expect(registration.enabled).toBe(true);
  });

  test("replaces the graph and reapplies settings when the context changes", async () => {
    const { browser, routing } = setup();
    await routing.applySettings({
      cueOutputId: "headphones",
      mainDelayMs: 90,
      mainOutputId: "speakers",
    });
    const firstMain = node("first-main", browser.context);
    routing.connectMain(firstMain);
    routing.registerCueDeck("deck-a", node("first-cue", browser.context), true);

    browser.context = { id: "context-2" } as unknown as AudioContext;
    const secondMain = node("second-main", browser.context);
    await routing.replaceContext(browser.context);
    routing.connectMain(secondMain);

    expect(browser.graphs).toHaveLength(2);
    expect(browser.graphs[0]?.disposed).toBe(true);
    expect(browser.graphs[1]?.mainConnections).toEqual(new Set([secondMain]));
    expect(browser.graphs[1]?.cueConnections).toEqual(new Set());
    expect(browser.graphs[1]?.mainDelayMs).toBe(90);
    expect(browser.mainSinkChanges).toEqual(["speakers", "speakers"]);
    expect(browser.cueSinkCreations).toEqual(["headphones", "headphones"]);
    expect(browser.cueSinkDisposals).toEqual(["headphones"]);
  });

  test("queues context replacement behind a deferred settings transaction", async () => {
    const { browser, persistence, routing } = setup();
    const firstSink = browser.deferNextMainSink();
    const replaySink = browser.deferNextMainSink();
    const applying = routing.applySettings({
      mainDelayMs: 90,
      mainOutputId: "speakers",
    });

    browser.context = { id: "context-2" } as unknown as AudioContext;
    const replacing = routing.replaceContext(browser.context);

    expect(browser.graphs).toHaveLength(1);
    firstSink.resolve();
    replaySink.resolve();
    await Promise.all([applying, replacing]);

    expect(browser.graphs).toHaveLength(2);
    expect(browser.graphs[0]?.disposed).toBe(true);
    expect(browser.graphs[1]?.mainDelayMs).toBe(90);
    expect(browser.mainSinkChanges).toEqual(["speakers", "speakers"]);
    expect(persistence.read().mainOutputId).toBe("speakers");
  });

  test("replays a deferred transaction when main output replaces its graph", async () => {
    const { browser, persistence, routing } = setup();
    const firstSink = browser.deferNextMainSink();
    const replaySink = browser.deferNextMainSink();
    const applying = routing.applySettings({
      mainDelayMs: 70,
      mainOutputId: "speakers",
    });

    browser.context = { id: "context-2" } as unknown as AudioContext;
    const mainOutput = routing.getMainOutput(browser.context);
    firstSink.resolve();
    replaySink.resolve();
    await applying;

    expect(mainOutput).toBe(browser.graphs[1]?.mainOutput);
    expect(browser.graphs[0]?.disposed).toBe(true);
    expect(browser.graphs[1]?.mainDelayMs).toBe(70);
    expect(browser.mainSinkChanges).toEqual(["speakers", "speakers"]);
    expect(persistence.writes).toHaveLength(1);
  });

  test("reports transaction errors until the listener unsubscribes", async () => {
    const { browser, routing } = setup();
    const errors: Error[] = [];
    const unsubscribe = routing.subscribeErrors((error) => {
      errors.push(error);
    });
    browser.cueSinkError = new Error("first failure");

    await expect(
      routing.applySettings({ cueOutputId: "headphones" })
    ).rejects.toThrow("first failure");
    expect(errors.map((error) => error.message)).toEqual(["first failure"]);

    unsubscribe();
    browser.cueSinkError = new Error("second failure");
    await expect(
      routing.applySettings({ cueOutputId: "headphones" })
    ).rejects.toThrow("second failure");
    expect(errors.map((error) => error.message)).toEqual(["first failure"]);
  });

  test("cleanup releases graph, sink, Deck, source, and error resources", async () => {
    const { browser, routing } = setup();
    await routing.applySettings({ cueOutputId: "headphones" });
    const main = node("main", browser.context);
    const cue = node("cue", browser.context);
    routing.connectMain(main);
    const registration = routing.registerCueDeck("deck-a", cue, true);
    routing.setHeadphoneVolume(0.6);
    const errors: Error[] = [];
    routing.subscribeErrors((error) => errors.push(error));

    routing.cleanup();
    routing.cleanup();

    expect(browser.graphs[0]?.disposed).toBe(true);
    expect(browser.graphs[0]?.mainConnections).toEqual(new Set());
    expect(browser.graphs[0]?.cueConnections).toEqual(new Set());
    expect(browser.cueSinkDisposals).toEqual(["headphones"]);
    expect(registration.enabled).toBe(false);

    browser.cueSinkError = new Error("after cleanup");
    await expect(
      routing.applySettings({ cueOutputId: "headphones" })
    ).rejects.toThrow("after cleanup");
    expect(errors).toEqual([]);
  });

  test("keeps Deck registrations usable after shared routing cleanup", async () => {
    const { browser, routing } = setup();
    await routing.applySettings({ cueOutputId: "headphones" });
    const registration = routing.registerCueDeck(
      "deck-a",
      node("first-cue", browser.context),
      true
    );

    routing.cleanup();
    await routing.applySettings({ cueOutputId: "headphones" });
    const restoredCue = node("restored-cue", browser.context);
    registration.replaceTap(restoredCue);
    registration.setEnabled(true);

    expect(browser.graphs[1]?.cueConnections).toEqual(new Set([restoredCue]));
    expect(registration.enabled).toBe(true);
  });

  test("keeps headphone volume when routing resumes after cleanup", async () => {
    const { browser, routing } = setup();
    routing.setHeadphoneVolume(0.35);

    routing.cleanup();
    await routing.applySettings({ cueOutputId: "headphones" });

    expect(browser.graphs[1]?.headphoneVolume).toBe(0.35);
    expect(routing.getSnapshot().headphoneVolume).toBe(0.35);
  });

  test("cleanup cancels a deferred transaction without recreating its graph", async () => {
    const { browser, persistence, routing } = setup();
    const deferredSink = browser.deferNextMainSink();
    const applying = routing.applySettings({
      mainDelayMs: 80,
      mainOutputId: "speakers",
    });
    const queued = routing.applySettings({ mainDelayMs: 20 });

    routing.cleanup();
    deferredSink.resolve();

    await expect(applying).rejects.toThrow(
      "Output routing transaction was cancelled by cleanup"
    );
    await expect(queued).rejects.toThrow(
      "Output routing transaction was cancelled by cleanup"
    );
    expect(browser.graphs).toHaveLength(1);
    expect(browser.graphs[0]?.disposed).toBe(true);
    expect(persistence.writes).toEqual([]);
    expect(routing.getSnapshot().settings).toEqual({
      cueDelayMs: 0,
      cueOutputId: null,
      mainDelayMs: 0,
      mainOutputId: "default",
    });

    await expect(
      routing.applySettings({ mainDelayMs: 30 })
    ).resolves.toMatchObject({ settings: { mainDelayMs: 30 } });
  });

  test("CUE release cancels and disposes a deferred sink creation", async () => {
    const { browser, persistence, routing } = setup();
    const deferredSink = browser.deferNextCueSink();
    const applying = routing.applySettings({ cueOutputId: "headphones" });

    await Promise.resolve();
    expect(browser.cueSinkCreations).toEqual(["headphones"]);
    routing.releaseCue();
    deferredSink.resolve();

    await expect(applying).rejects.toThrow(
      "Output routing transaction was cancelled by CUE release"
    );
    expect(browser.cueSinkDisposals).toEqual(["headphones"]);
    expect(routing.getSnapshot().cueActive).toBe(false);
    expect(routing.getSnapshot().settings.cueOutputId).toBeNull();
    expect(persistence.writes).toEqual([]);
  });

  test("CUE release owns a deferred sink switch without restoring either sink", async () => {
    const { browser, persistence, routing } = setup();
    await routing.applySettings({ cueOutputId: "headphones-a" });
    const deferredSink = browser.deferNextCueSink();
    const switching = routing.applySettings({ cueOutputId: "headphones-b" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.cueSinkCreations).toEqual(["headphones-a", "headphones-b"]);
    routing.releaseCue();
    deferredSink.resolve();

    await expect(switching).rejects.toThrow(
      "Output routing transaction was cancelled by CUE release"
    );
    expect(browser.cueSinkDisposals).toEqual(["headphones-a", "headphones-b"]);
    expect(routing.getSnapshot().cueActive).toBe(false);
    expect(routing.getSnapshot().settings.cueOutputId).toBeNull();
    expect(persistence.read().cueOutputId).toBe("headphones-a");
    expect(persistence.writes).toHaveLength(1);
  });

  test("replaying unchanged settings is idempotent", async () => {
    const { browser, persistence, routing } = setup();
    const settings = {
      cueDelayMs: 20,
      cueOutputId: "headphones",
      mainDelayMs: 80,
      mainOutputId: "speakers",
    };
    await routing.applySettings(settings);

    const snapshot = await routing.applySettings();

    expect(snapshot.settings).toEqual(settings);
    expect(browser.graphs).toHaveLength(1);
    expect(browser.mainSinkChanges).toEqual(["speakers"]);
    expect(browser.cueSinkCreations).toEqual(["headphones"]);
    expect(browser.cueSinkDisposals).toEqual([]);
    expect(persistence.writes).toHaveLength(1);
  });

  test("selecting the CUE device as main atomically disables CUE", async () => {
    const cueChanges: [string, boolean][] = [];
    const { browser, persistence, routing } = setup(
      undefined,
      (deckId, enabled) => {
        cueChanges.push([deckId, enabled]);
      }
    );
    await routing.applySettings({
      cueOutputId: "headphones",
      mainOutputId: "speakers",
    });
    const registration = routing.registerCueDeck(
      "deck-a",
      node("cue", browser.context),
      true
    );

    const snapshot = await routing.applySettings({
      mainOutputId: "headphones",
    });

    expect(snapshot.settings.mainOutputId).toBe("headphones");
    expect(snapshot.settings.cueOutputId).toBeNull();
    expect(snapshot.cueActive).toBe(false);
    expect(registration.enabled).toBe(false);
    expect(cueChanges).toEqual([
      ["deck-a", true],
      ["deck-a", false],
    ]);
    expect(browser.cueSinkDisposals).toEqual(["headphones"]);
    expect(persistence.read()).toEqual(snapshot.settings);
  });
});
