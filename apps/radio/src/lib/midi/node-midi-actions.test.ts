import { describe, expect, mock, test } from "bun:test";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { removeNodes, setEffectParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  createNodeStore,
  type NodeStore,
  undoNodeGraph,
} from "@/lib/node-graph/node-store";
import { addPaletteNode } from "@/lib/node-graph/palette";
import {
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import {
  createMidiControl,
  type MidiBrowserAccess,
  type MidiBrowserAdapter,
  type MidiMappingPersistence,
  type PersistedMidiControl,
} from "./midi-control";
import {
  createNodeMidiActions,
  type NodeMidiCommit,
  nodeMidiSignature,
} from "./node-midi-actions";
import type { MidiAction } from "./types";

const position = { x: 0, y: 0 };

/** Two Compressors, a Filter and a Station: only FX and strip have params. */
function buildGraph(): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [],
    nodes: [
      {
        data: {
          radio: { id: "kexp", name: "KEXP", streamUrl: "https://k.test" },
        },
        id: "kexp",
        position,
        type: "station",
      },
      {
        data: { effect: createNodeEffectConfig("compressor", "comp") },
        id: "comp",
        position,
        type: "compressor",
      },
      { data: {}, id: "lp", position, type: "filter" },
      {
        data: { effect: createNodeEffectConfig("compressor", "comp-2") },
        id: "comp-2",
        position,
        type: "compressor",
      },
    ],
    version: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
  } satisfies NodeGraphInput);
}

function storeCommit(store: NodeStore): NodeMidiCommit {
  return (update, history) => {
    commitNodeGraph(update, store, history);
  };
}

function effectOf(store: NodeStore, nodeId: string): Record<string, unknown> {
  const node = store.state.graph?.nodes.find((entry) => entry.id === nodeId);
  const data = node?.data as { effect: Record<string, unknown> } | undefined;
  return data?.effect ?? {};
}

class MemoryPersistence implements MidiMappingPersistence {
  value: PersistedMidiControl | null = null;

  read(): PersistedMidiControl | null {
    return this.value;
  }

  write(value: PersistedMidiControl): void {
    this.value = value;
  }
}

/** One input whose messages the test emits, and frames it flushes. */
class FakeBrowser implements MidiBrowserAdapter {
  private frame: (() => void) | null = null;
  private readonly listeners = new Set<(data: Uint8Array) => void>();
  private readonly access: MidiBrowserAccess = {
    inputs: () => [
      {
        device: {
          id: "input-1",
          manufacturer: "Test",
          name: "Test MIDI",
          state: "connected",
          type: "input",
        },
        subscribe: (listener) => {
          this.listeners.add(listener);
          return () => this.listeners.delete(listener);
        },
      },
    ],
    subscribeStateChange: () => () => undefined,
  };

  cancelFrame(): void {
    this.frame = null;
  }

  emit(data: number[]): void {
    for (const listener of this.listeners) {
      listener(Uint8Array.from(data));
    }
  }

  flushFrame(): void {
    const pending = this.frame;
    this.frame = null;
    pending?.();
  }

  isSupported(): boolean {
    return true;
  }

  /** Advance it past the 33 ms CC throttle between dispatches. */
  time = 1000;

  now(): number {
    return this.time;
  }

  requestAccess(): Promise<MidiBrowserAccess> {
    return Promise.resolve(this.access);
  }

  requestFrame(callback: () => void): number {
    this.frame = callback;
    return 1;
  }

  subscribePermission(): () => void {
    return () => undefined;
  }
}

async function connectedControl(staticActions: MidiAction[] = []) {
  const browser = new FakeBrowser();
  const control = createMidiControl({
    browser,
    persistence: new MemoryPersistence(),
    staticActions,
  });
  await control.connect();
  control.change({ enabled: true, type: "set-enabled" });
  return { browser, control };
}

describe("createNodeMidiActions", () => {
  test("groups each node's params under its title", () => {
    const store = createNodeStore(buildGraph());
    const actions = createNodeMidiActions(
      store.state.graph as NodeGraph,
      storeCommit(store)
    );
    const groups = new Map<string, string[]>();
    for (const action of actions) {
      groups.set(action.group, [
        ...(groups.get(action.group) ?? []),
        action.targetId,
      ]);
    }

    // The Station has no params; a second Compressor gets a number.
    expect([...groups.keys()]).toEqual([
      "Compressor",
      "Filter",
      "Compressor 2",
    ]);
    expect(groups.get("Compressor")).toContain("node:comp:threshold");
    expect(groups.get("Compressor")).toContain("node:comp:enabled");
    expect(groups.get("Compressor")).toContain("node:comp:dryWet");
    expect(groups.get("Compressor 2")).toContain("node:comp-2:threshold");
    expect(groups.get("Filter")).toEqual(["node:lp:frequency", "node:lp:Q"]);
    const threshold = actions.find(
      (action) => action.targetId === "node:comp:threshold"
    );
    expect(threshold?.label).toBe("Threshold");
    expect(threshold?.type).toBe("continuous");
  });

  test("a dispatch commits the param, and the enable button toggles", () => {
    const store = createNodeStore(buildGraph());
    const actions = createNodeMidiActions(
      store.state.graph as NodeGraph,
      storeCommit(store)
    );
    const byTarget = new Map(actions.map((a) => [a.targetId, a]));

    byTarget.get("node:comp:threshold")?.dispatch(0.5);
    expect(effectOf(store, "comp").threshold).toBe(-30);
    expect(effectOf(store, "comp-2").threshold).not.toBe(-30);

    // Cutoff spreads by ratio, like its knob: halfway is the geometric mean.
    byTarget.get("node:lp:frequency")?.dispatch(0.5);
    const filter = store.state.graph?.nodes.find((node) => node.id === "lp");
    const data = filter?.data as { frequency: number } | undefined;
    expect(data?.frequency).toBeCloseTo(Math.sqrt(20 * 20_000), 6);

    const { enabled } = effectOf(store, "comp");
    byTarget.get("node:comp:enabled")?.dispatch(1);
    expect(effectOf(store, "comp").enabled).toBe(!enabled);
  });

  test("the signature follows the patch's shape, not its params", () => {
    const graph = buildGraph();
    const turned = setEffectParams(graph, "comp", { threshold: -12 } as never);

    expect(nodeMidiSignature(turned)).toBe(nodeMidiSignature(graph));
    expect(
      nodeMidiSignature({
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== "comp-2"),
      })
    ).not.toBe(nodeMidiSignature(graph));
  });
});

describe("node MIDI through the MIDI control", () => {
  test("a deleted node's learned CC stays dormant for a new instance and follows Undo", async () => {
    const entry = {
      id: "compressor",
      kind: "node",
      name: "Compressor",
      section: "fx",
      type: "compressor",
    } as const;
    const original = addPaletteNode(buildNodeGraphFromTemplate("blank"), entry);
    const originalId = original.nodeId as string;
    const store = createNodeStore(original.graph);
    const { browser, control } = await connectedControl();
    const binding = control.bindActions();
    const updateActions = () =>
      binding.update(
        createNodeMidiActions(
          store.state.graph as NodeGraph,
          storeCommit(store)
        )
      );
    updateActions();
    control.activateNode();
    const targetId = `node:${originalId}:threshold` as const;
    control.change({ targetId, type: "start-learn" });
    browser.emit([0xb0, 21, 64]);

    commitNodeGraph(
      (graph) => removeNodes(graph, [originalId]),
      store,
      "snapshot"
    );
    updateActions();
    let addedId = "";
    commitNodeGraph(
      (graph) => {
        const added = addPaletteNode(graph, entry);
        addedId = added.nodeId as string;
        return added.graph;
      },
      store,
      "snapshot"
    );
    updateActions();
    const newThreshold = effectOf(store, addedId).threshold;
    browser.emit([0xb0, 21, 127]);
    browser.flushFrame();
    expect(effectOf(store, addedId).threshold).toBe(newThreshold);
    expect(addedId).not.toBe(originalId);
    expect(control.getSnapshot().mappingsByTarget.has(targetId)).toBe(true);

    expect(undoNodeGraph(store)).toBe(true);
    expect(undoNodeGraph(store)).toBe(true);
    updateActions();
    browser.time += 100;
    browser.emit([0xb0, 21, 127]);
    browser.flushFrame();
    expect(effectOf(store, originalId).threshold).toBe(0);
    binding.dispose();
  });

  test("node params list as a group named after the node title", async () => {
    const store = createNodeStore(buildGraph());
    const { control } = await connectedControl();
    const binding = control.bindActions();
    binding.update(
      createNodeMidiActions(store.state.graph as NodeGraph, storeCommit(store))
    );

    const listed = control
      .getSnapshot()
      .actions.filter((action) => action.group === "Compressor");
    expect(listed.map((action) => action.targetId)).toContain(
      "node:comp:threshold"
    );

    binding.dispose();
    expect(
      control
        .getSnapshot()
        .actions.some((action) => action.group === "Compressor")
    ).toBe(false);
  });

  test("a learned mapping drives the param while Node mode is up", async () => {
    const store = createNodeStore(buildGraph());
    const { browser, control } = await connectedControl();
    const binding = control.bindActions();
    binding.update(
      createNodeMidiActions(store.state.graph as NodeGraph, storeCommit(store))
    );

    control.change({ targetId: "node:comp:threshold", type: "start-learn" });
    browser.emit([0xb0, 21, 64]);
    expect(
      control.getSnapshot().mappingsByTarget.get("node:comp:threshold")
    ).toMatchObject({ channel: 0, control: 21, type: "cc" });

    // Outside Node mode the mapping holds still.
    browser.emit([0xb0, 21, 127]);
    browser.flushFrame();
    expect(effectOf(store, "comp").threshold).not.toBe(0);

    const deactivate = control.activateNode();
    browser.emit([0xb0, 21, 127]);
    browser.flushFrame();
    expect(effectOf(store, "comp").threshold).toBe(0);

    deactivate();
    browser.emit([0xb0, 21, 0]);
    browser.flushFrame();
    expect(effectOf(store, "comp").threshold).toBe(0);
  });

  test("DJ targets stay silent in Node mode", async () => {
    const volume = mock((_value: number) => undefined);
    const { browser, control } = await connectedControl([
      {
        dispatch: volume,
        group: "deck-a",
        label: "Volume",
        targetId: "deck-a:volume",
        type: "continuous",
      },
    ]);
    control.change({ targetId: "deck-a:volume", type: "start-learn" });
    browser.emit([0xb0, 7, 0]);

    control.activateNode();
    browser.emit([0xb0, 7, 127]);
    browser.flushFrame();
    expect(volume).not.toHaveBeenCalled();

    control.activateDj();
    browser.emit([0xb0, 7, 127]);
    browser.flushFrame();
    expect(volume).toHaveBeenCalledWith(1);
  });

  test("one knob can drive a DJ control and a node param, each in its mode", async () => {
    const volume = mock((_value: number) => undefined);
    const store = createNodeStore(buildGraph());
    const { browser, control } = await connectedControl([
      {
        dispatch: volume,
        group: "deck-a",
        label: "Volume",
        targetId: "deck-a:volume",
        type: "continuous",
      },
    ]);
    const binding = control.bindActions();
    binding.update(
      createNodeMidiActions(store.state.graph as NodeGraph, storeCommit(store))
    );
    control.change({ targetId: "deck-a:volume", type: "start-learn" });
    browser.emit([0xb0, 7, 0]);
    control.change({ targetId: "node:comp:threshold", type: "start-learn" });
    browser.emit([0xb0, 7, 0]);

    // Learning it for the node param left the DJ mapping in place.
    const deactivateDj = control.activateDj();
    browser.emit([0xb0, 7, 127]);
    browser.flushFrame();
    expect(volume).toHaveBeenCalledWith(1);
    expect(effectOf(store, "comp").threshold).not.toBe(0);
    deactivateDj();

    volume.mockClear();
    browser.time += 100;
    control.activateNode();
    browser.emit([0xb0, 7, 127]);
    browser.flushFrame();
    expect(effectOf(store, "comp").threshold).toBe(0);
    expect(volume).not.toHaveBeenCalled();
  });

  test("learning a knob for a second node param takes it off the first", async () => {
    const { browser, control } = await connectedControl();
    control.change({ targetId: "node:comp:threshold", type: "start-learn" });
    browser.emit([0xb0, 7, 0]);
    control.change({ targetId: "node:comp-2:threshold", type: "start-learn" });
    browser.emit([0xb0, 7, 0]);

    const { mappingsByTarget } = control.getSnapshot();
    expect(mappingsByTarget.has("node:comp:threshold")).toBe(false);
    expect(mappingsByTarget.get("node:comp-2:threshold")).toMatchObject({
      control: 7,
    });

    // Removing the newer mapping leaves the knob unmapped.
    control.change({
      targetId: "node:comp-2:threshold",
      type: "remove-mapping",
    });
    expect(control.getSnapshot().mappings).toEqual([]);
  });

  test("loading a DJ preset keeps learned node params", async () => {
    const { browser, control } = await connectedControl();
    control.change({ targetId: "node:comp:threshold", type: "start-learn" });
    browser.emit([0xb0, 21, 0]);

    control.change({ presetId: "generic-2-deck", type: "load-preset" });

    const { activePresetId, mappingsByTarget } = control.getSnapshot();
    expect(activePresetId).toBe("generic-2-deck");
    expect(mappingsByTarget.get("node:comp:threshold")).toMatchObject({
      control: 21,
    });
    expect(mappingsByTarget.has("deck-a:volume")).toBe(true);
  });
});
