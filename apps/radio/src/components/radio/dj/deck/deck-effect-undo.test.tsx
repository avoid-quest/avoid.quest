import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  spyOn,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { toast } from "sonner";
import { installAnimationTestEnvironment } from "../shared/animation-test-utils";

let EffectChain: typeof import("@/components/audio/effect-chain")["EffectChain"];
let createEffectResetPatch: typeof import("@/components/audio/effect-item")["createEffectResetPatch"];
let clock: ReturnType<typeof installAnimationTestEnvironment>;
beforeAll(async () => {
  const environment = installAnimationTestEnvironment();
  ({ createEffectResetPatch } = await import("@/components/audio/effect-item"));
  ({ EffectChain } = await import("@/components/audio/effect-chain"));
  environment.restore();
});

import { createDefaultEffectConfig, type EffectConfig } from "@/lib/audio";
import {
  findEffectInTree,
  isEffectContainer,
  normalizeEffectTree,
  validateEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import {
  getPlaybackChannel,
  initializePlaybackSessions,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getDjDeckModule } from "@/lib/dj-deck";
import { changeDjEffectWithUndo } from "./deck-effect-undo";

let notify: ReturnType<typeof spyOn<typeof toast, "success">>;
const tree = () => getPlaybackChannel("dj", "deck-a")?.effects ?? [];

beforeEach(async () => {
  clock = installAnimationTestEnvironment();
  await initializePlaybackSessions();
  notify = spyOn(toast, "success").mockReturnValue("test-undo");
  const rack = createDefaultEffectConfig("fxComposite", "rack", 1);
  const child = createDefaultEffectConfig("stereoSplit", "nested", 0);
  const [inner] = child.chains;
  const [outer] = rack.chains;
  if (!(inner && outer)) {
    throw new Error("Missing fixture chains");
  }
  child.sidechain = { channelId: "deck-b" };
  inner.effects = [
    { ...createDefaultEffectConfig("delay", "delay", 0), feedback: 0.73 },
  ];
  outer.effects = [child];
  outer.gain = 0.42;
  outer.name = "Configured chain";
  updatePlaybackChannel("dj", "deck-a", (draft) => {
    draft.radio = null;
    draft.effects = normalizeEffectTree([
      createDefaultEffectConfig("gate", "before", 0),
      rack,
      createDefaultEffectConfig("limiter", "after", 2),
    ]);
  });
});
afterEach(async () => {
  cleanup();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  notify.mockRestore();
  clock.restore();
});

function undo() {
  const action = notify.mock.calls.at(-1)?.[1]?.action;
  if (!(action && typeof action === "object" && "onClick" in action)) {
    throw new Error("Expected an Undo action");
  }
  action.onClick({} as Parameters<typeof action.onClick>[0]);
}
function edit(change: import("@/lib/channel-effects").ChannelEffectsChange) {
  getDjDeckModule().deck("deck-a").change({ change, type: "effect" });
}

function effect(id: string): EffectConfig {
  const found = findEffectInTree(tree(), id);
  if (!found) {
    throw new Error(`Missing ${id}`);
  }
  return found;
}

test("remove and undo restore a configured subtree exactly at its position", () => {
  const before = structuredClone(tree());
  changeDjEffectWithUndo("deck-a", { effectId: "rack", type: "remove" });
  expect(findEffectInTree(tree(), "rack")).toBeUndefined();
  expect(notify).toHaveBeenCalledTimes(1);
  undo();
  expect(tree()).toEqual(before);
});

test("remove undo keeps later sibling edits and restores beside surviving neighbours", () => {
  const saved = structuredClone(effect("rack"));
  changeDjEffectWithUndo("deck-a", { effectId: "rack", type: "remove" });
  edit({ effectId: "before", patch: { enabled: false }, type: "update" });
  edit({ effectId: "after", type: "remove" });
  edit({ effect: createDefaultEffectConfig("gate", "new", 1), type: "add" });
  undo();
  expect(tree().map(({ id }) => id)).toEqual(["before", "rack", "new"]);
  expect(effect("rack")).toEqual(saved);
  expect(effect("before").enabled).toBe(false);
});

test("reset and undo recover nested IDs, parameters, sidechains and chain order", () => {
  const before = structuredClone(tree());
  const rack = effect("rack");
  changeDjEffectWithUndo(
    "deck-a",
    { effectId: "rack", patch: createEffectResetPatch(rack), type: "update" },
    true
  );
  expect(findEffectInTree(tree(), "delay")).toBeUndefined();
  undo();
  expect(tree()).toEqual(before);
});

test("reset undo preserves later parameter edits and newly added nested effects", () => {
  const before = structuredClone(effect("rack"));
  changeDjEffectWithUndo(
    "deck-a",
    { effectId: "rack", patch: createEffectResetPatch(before), type: "update" },
    true
  );
  const reset = effect("rack");
  if (!isEffectContainer(reset)) {
    throw new Error("Expected a container");
  }
  const [chain] = reset.chains;
  if (!chain) {
    throw new Error("Missing reset chain");
  }
  edit({
    chainId: chain.id,
    effect: createDefaultEffectConfig("gate", "new-child", 0),
    type: "add",
  });
  edit({ effectId: "rack", patch: { dryWet: 0.23 }, type: "update" });
  edit({ effectId: "after", patch: { enabled: false }, type: "update" });
  undo();
  const restored = effect("rack");
  expect(restored.dryWet).toBe(0.23);
  expect(effect("after").enabled).toBe(false);
  expect(findEffectInTree([restored], "nested")).toEqual(
    findEffectInTree([before], "nested")
  );
  expect(findEffectInTree([restored], "new-child")).toBeDefined();
  expect(
    isEffectContainer(restored) &&
      isEffectContainer(before) &&
      restored.chains.map(({ id }) => id)
  ).toEqual(isEffectContainer(before) && before.chains.map(({ id }) => id));
});

test("a nested removal restores into the nearest surviving chain after structural changes", () => {
  const saved = structuredClone(effect("nested"));
  const rack = effect("rack");
  if (!isEffectContainer(rack)) {
    throw new Error("Expected a container");
  }
  changeDjEffectWithUndo("deck-a", {
    effectId: "rack",
    patch: {
      chains: rack.chains.map((chain) => ({ ...chain, effects: [] })),
    } as Partial<EffectConfig>,
    type: "update",
  });
  edit({
    effectId: "rack",
    patch: { chains: [] } as Partial<EffectConfig>,
    type: "update",
  });
  undo();
  expect(tree().map(({ id }) => id)).toEqual([
    "before",
    "rack",
    "nested",
    "after",
  ]);
  expect(effect("nested")).toEqual({ ...saved, order: 2 });
});

test("effect reset and remove buttons expose the same recovery for configured containers", () => {
  const saved = structuredClone(effect("rack"));
  const remove = (effectId: string) =>
    changeDjEffectWithUndo("deck-a", { effectId, type: "remove" });
  const reset = (effectId: string, patch: Partial<EffectConfig>) =>
    changeDjEffectWithUndo("deck-a", { effectId, patch, type: "update" }, true);
  const ignore = () => undefined;
  const view = render(
    <EffectChain
      deckId="deck-a"
      effects={tree()}
      onAddEffect={ignore}
      onRemoveEffect={remove}
      onReorderEffects={ignore}
      onResetEffect={reset}
      onUpdateEffect={ignore}
    />
  );
  fireEvent.click(view.getByRole("button", { name: "Reset FX Composite" }));
  expect(findEffectInTree(tree(), "delay")).toBeUndefined();
  act(undo);
  expect(effect("rack")).toEqual(saved);
  fireEvent.click(view.getByRole("button", { name: "Remove FX Composite" }));
  expect(findEffectInTree(tree(), "rack")).toBeUndefined();
  act(undo);
  expect(effect("rack")).toEqual(saved);
});

test("reset undo can recover its subtree after a later structural removal", () => {
  const saved = structuredClone(effect("rack"));
  changeDjEffectWithUndo(
    "deck-a",
    {
      effectId: "rack",
      patch: createEffectResetPatch(effect("rack")),
      type: "update",
    },
    true
  );
  edit({ effectId: "rack", type: "remove" });
  edit({ effectId: "before", patch: { enabled: false }, type: "update" });
  undo();
  expect(effect("rack")).toEqual(saved);
  expect(effect("before").enabled).toBe(false);
});

test.each(["crossover", "bands", "two-band layout"])(
  "reset undo keeps split layout valid after later %s edits",
  (later) => {
    const split = createDefaultEffectConfig("frequencySplit", "split", 1);
    const [band] = split.chains;
    if (!band) {
      throw new Error("Missing band fixture");
    }
    split.chains = [0, 1].map((order) => ({
      ...band,
      effects: [],
      id: `original-${order}`,
      order,
    }));
    split.crossoverFrequencies = [1500];
    split.frequencyBandCount = 2;
    edit({ tree: [effect("before"), split], type: "replace" });
    changeDjEffectWithUndo(
      "deck-a",
      {
        effectId: split.id,
        patch: createEffectResetPatch(split),
        type: "update",
      },
      true
    );
    const reset = effect(split.id);
    if (reset.type !== "frequencySplit") {
      throw new Error("Expected a split");
    }
    let { chains } = reset;
    let crossoverFrequencies = [220, 1040, 5060];
    if (later === "bands") {
      chains = reset.chains.slice(0, 3);
      crossoverFrequencies = [300, 2000];
    } else if (later === "two-band layout") {
      const [low] = reset.chains;
      const high = reset.chains.at(-1);
      if (!(low && high)) {
        throw new Error("Missing split bands");
      }
      chains = [low, high];
      crossoverFrequencies = [500];
    }
    edit({
      effectId: split.id,
      patch: {
        chains,
        crossoverFrequencies,
        dryWet: 0.23,
        frequencyBandCount: chains.length,
      } as Partial<EffectConfig>,
      type: "update",
    });
    edit({ effectId: "before", patch: { enabled: false }, type: "update" });
    undo();
    expect(validateEffectTree(tree(), new Set(["deck-a", "deck-b"]))).toEqual(
      []
    );
    const restored = effect(split.id);
    if (restored.type !== "frequencySplit") {
      throw new Error("Expected a split");
    }
    expect(restored.chains).toEqual(split.chains);
    expect(restored.crossoverFrequencies).toEqual(split.crossoverFrequencies);
    expect(restored.dryWet).toBe(0.23);
    expect(effect("before").enabled).toBe(false);
  }
);
