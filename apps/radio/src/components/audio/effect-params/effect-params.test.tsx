/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";
import type { EffectConfig } from "@/lib/audio";
import { MAX_EFFECT_TREE_DEPTH } from "@/lib/audio/dsp/routing/effect-tree";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ObserverStub {
  disconnect() {
    // JSDOM does not perform layout.
  }

  observe() {
    // JSDOM does not perform layout.
  }

  unobserve() {
    // JSDOM does not perform layout.
  }
}

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  SVGElement: dom.window.SVGElement,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

// React DOM checks for input events when it loads, so it loads after the DOM.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

// Radix Select measures and scrolls, and knobs capture the pointer, which
// JSDOM does not do.
for (const [key, value] of Object.entries({
  hasPointerCapture: (): boolean => false,
  releasePointerCapture: (): void => undefined,
  scrollIntoView: (): void => undefined,
  setPointerCapture: (): void => undefined,
})) {
  Object.defineProperty(dom.window.HTMLElement.prototype, key, {
    configurable: true,
    value,
    writable: true,
  });
}

let EffectParams: typeof import("./effect-params")["EffectParams"];
let ParamSlider: typeof import("./param-slider")["ParamSlider"];
let createDefaultEffectConfig: typeof import("@/lib/audio/dsp/effects/registry")["createDefaultEffectConfig"];
let effectConfigSchema: typeof import("@/lib/audio/dsp/effects/effect-config-schema")["effectConfigSchema"];
let nodeEffectConfigSchema: typeof import("@/lib/audio/dsp/effects/effect-config-schema")["nodeEffectConfigSchema"];

beforeAll(async () => {
  ({ EffectParams } = await import("./effect-params"));
  ({ ParamSlider } = await import("./param-slider"));
  ({ createDefaultEffectConfig } = await import(
    "@/lib/audio/dsp/effects/registry"
  ));
  ({ effectConfigSchema, nodeEffectConfigSchema } = await import(
    "@/lib/audio/dsp/effects/effect-config-schema"
  ));
});

afterEach(cleanup);

const noop = () => undefined;

/** Every MIDI learn target the rendered params expose. */
function midiTargets(
  effect: EffectConfig,
  props: Partial<Parameters<typeof EffectParams>[0]> = {}
): string[] {
  const view = render(
    <EffectParams effect={effect} onUpdate={noop} {...props} />
  );
  const targets = [...view.container.querySelectorAll("[data-midi-target]")]
    .map((element) => element.getAttribute("data-midi-target") ?? "")
    .sort();
  cleanup();
  return targets;
}

describe("EffectParams MIDI targets", () => {
  test("a midiTargetPrefix addresses each param as <prefix>:<paramKey>", () => {
    const compressor = createDefaultEffectConfig("compressor", "c1", 0);
    const targets = midiTargets(compressor, { midiTargetPrefix: "node:abc" });

    expect(targets).toContain("node:abc:threshold");
    expect(targets).toContain("node:abc:ratio");
    // The shared mix row follows the same prefix.
    expect(targets).toContain("node:abc:dryWet");
    expect(targets.every((target) => target.startsWith("node:abc:"))).toBe(
      true
    );
  });

  test("the EQ and declarative renderers take the prefix too", () => {
    const eq = midiTargets(createDefaultEffectConfig("revamp", "eq", 0), {
      midiTargetPrefix: "node:eq",
    });
    expect(eq.length).toBeGreaterThan(0);
    expect(eq.every((target) => target.startsWith("node:eq:"))).toBe(true);

    const werkstatt = midiTargets(
      createDefaultEffectConfig("werkstatt", "w", 0),
      { midiTargetPrefix: "node:w" }
    );
    expect(werkstatt).toContain("node:w:dryWet");
  });

  test("a container's branches are node:<nodeId>:chain:<chainId>:…", () => {
    const split = createDefaultEffectConfig("fxComposite", "split", 0);
    const chainIds = (split as { chains: { id: string }[] }).chains.map(
      (chain) => chain.id
    );
    const targets = midiTargets(split, { midiTargetPrefix: "node:split" });

    expect(chainIds.length).toBeGreaterThan(0);
    for (const chainId of chainIds) {
      expect(targets).toContain(`node:split:chain:${chainId}:gain`);
      expect(targets).toContain(`node:split:chain:${chainId}:pan`);
    }
  });

  test("DJ callers without the prop keep their deck targets", () => {
    const compressor = createDefaultEffectConfig("compressor", "fx1", 0);
    const deck = midiTargets(compressor, {
      deckId: "deck-a",
      effectId: "fx1",
    });

    expect(deck).toContain("deck-a:effect:fx1:threshold");
    expect(deck).toContain("deck-a:effect:fx1:dryWet");
    expect(
      deck.every((target) => target.startsWith("deck-a:effect:fx1:"))
    ).toBe(true);

    const split = createDefaultEffectConfig("fxComposite", "split", 0);
    const [chain] = (split as { chains: { id: string }[] }).chains;
    expect(
      midiTargets(split, { deckId: "deck-b", effectId: "split" })
    ).toContain(`deck-b:effect:split:chain:${chain?.id}:gain`);

    // Without a deck or a prefix, nothing is learnable.
    expect(midiTargets(compressor)).toEqual([]);
  });
});

describe("EffectParams selects", () => {
  test.each([
    ["vocoder", "Bands", "12 bands", { bandCount: 12 }],
    ["fold", "Oversample", "4x", { oversample: 4 }],
  ] as const)(
    "a numeric %s select commits a number the schemas accept",
    async (type, label, option, expected) => {
      const onUpdate = mock((_config: Partial<EffectConfig>) => undefined);
      const effect = createDefaultEffectConfig(type, "fx", 0);
      const view = render(<EffectParams effect={effect} onUpdate={onUpdate} />);

      fireEvent.keyDown(view.getByRole("combobox", { name: label }), {
        key: "Enter",
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      fireEvent.click(view.getByRole("option", { name: option }));

      expect(onUpdate).toHaveBeenCalledWith(expected);
      const updated = { ...effect, ...expected };
      expect(effectConfigSchema.safeParse(updated).success).toBe(true);
      expect(nodeEffectConfigSchema.safeParse(updated).success).toBe(true);
    }
  );
});

type Composite = Extract<EffectConfig, { type: "fxComposite" }>;

function composite(id: string, effects: EffectConfig[]): Composite {
  const effect = createDefaultEffectConfig("fxComposite", id, 0) as Composite;
  return {
    ...effect,
    chains: effect.chains.map((chain, index) => ({
      ...chain,
      effects: index === 0 ? effects : [],
    })),
  };
}

function StatefulEditor({
  initial,
  onUpdate = noop,
  ...props
}: Partial<Parameters<typeof EffectParams>[0]> & {
  initial: EffectConfig;
}) {
  const [effect, setEffect] = useState(initial);
  return (
    <EffectParams
      {...props}
      effect={effect}
      onUpdate={(patch) => {
        onUpdate(patch);
        setEffect((current) => ({ ...current, ...patch }) as EffectConfig);
      }}
    />
  );
}

describe("shared root and nested controls", () => {
  test.each([false, true])(
    "tailored controls, EQ bands and special editors (nested: %s)",
    async (nested) => {
      const cases = [
        ["compressor", "Compressor", "Timing"],
        ["gate", "Gate", "Envelope"],
        ["vocoder", "Vocoder", "Carrier"],
        ["revamp", "7-Band EQ", "HP"],
        ["werkstatt", "Werkstatt", "Playground"],
        ["neuralAmp", "Tone3000", "Local NAM model"],
      ] as const;
      for (const [type, name, label] of cases) {
        const child = createDefaultEffectConfig(type, "child", 0);
        const effect = nested ? composite("root", [child]) : child;
        const view = render(
          <EffectParams deckId="deck-a" effect={effect} onUpdate={noop} />
        );
        if (nested) {
          fireEvent.click(view.getByRole("button", { name }));
        }
        expect(view.getByText(label)).toBeTruthy();
        if (type === "compressor" || type === "gate") {
          expect(
            view.getByRole("combobox", { name: "Sidechain input" })
          ).toBeTruthy();
        }
        if (type === "revamp") {
          expect(view.getAllByRole("slider", { name: "Freq" })).toHaveLength(7);
          expect(view.getByRole("switch", { name: "HP enabled" })).toBeTruthy();
        }
        // Allow Werkstatt's declaration parser to finish before unmounting.
        // biome-ignore lint/performance/noAwaitInLoops: each render must settle before cleanup.
        await act(() => Promise.resolve());
        cleanup();
      }
    }
  );

  test.each(["deck", "node"])(
    "%s MIDI targets keep every chain and effect identity at two levels",
    (mode) => {
      const children = [
        createDefaultEffectConfig("compressor", "comp", 0),
        createDefaultEffectConfig("revamp", "eq", 1),
      ];
      const inner = composite("inner", children);
      const root = composite("root", [inner]);
      const prefix = mode === "node" ? "node:root" : "deck-b:effect:root";
      const childPrefix = `${prefix}:chain:${root.chains[0]?.id}:effect:inner:chain:${inner.chains[0]?.id}:effect`;
      const view = render(
        <EffectParams
          deckId="deck-b"
          effect={root}
          effectId="root"
          midiTargetPrefix={mode === "node" ? prefix : undefined}
          onUpdate={noop}
        />
      );
      for (const name of ["FX Composite", "Compressor", "7-Band EQ"]) {
        fireEvent.click(view.getByRole("button", { name }));
      }
      const targets = [
        ...view.container.querySelectorAll("[data-midi-target]"),
      ].map((element) => element.getAttribute("data-midi-target"));
      expect(targets).toContain(`${childPrefix}:comp:threshold`);
      expect(targets).toContain(`${childPrefix}:comp:dryWet`);
      expect(targets).toContain(`${childPrefix}:eq:highPassFrequency`);
      expect(targets).toContain(`${childPrefix}:eq:dryWet`);
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets.every((target) => target?.startsWith(`${prefix}:`))).toBe(
        true
      );
    }
  );

  test("nested edits, bypass and removal preserve siblings and expansion", async () => {
    const compressor = createDefaultEffectConfig("compressor", "comp", 1);
    const gate = createDefaultEffectConfig("gate", "gate", 0);
    const inner = composite("inner", [compressor, gate]);
    const root = composite("root", [inner]);
    const onUpdate = mock((_patch: Partial<EffectConfig>) => undefined);
    const view = render(
      <StatefulEditor deckId="deck-a" initial={root} onUpdate={onUpdate} />
    );
    fireEvent.click(view.getByRole("button", { name: "FX Composite" }));
    const headers = view
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(headers.indexOf("Gate")).toBeLessThan(headers.indexOf("Compressor"));
    fireEvent.click(view.getByRole("button", { name: "Compressor" }));
    fireEvent.keyDown(view.getByRole("slider", { name: "Threshold" }), {
      key: "ArrowUp",
    });
    const lastInner = () => {
      const patch = onUpdate.mock.calls.at(-1)?.[0] as Partial<Composite>;
      expect(patch.chains?.[1]).toEqual(root.chains[1]);
      return patch.chains?.[0]?.effects[0] as Composite;
    };
    let updated = lastInner();
    expect(updated.chains[0]?.effects[0]).toMatchObject({
      id: "comp",
      threshold: (compressor as { threshold: number }).threshold + 0.5,
    });
    expect(updated.chains[0]?.effects[1]).toEqual(gate);
    fireEvent.keyDown(view.getByRole("combobox", { name: "Sidechain input" }), {
      key: "Enter",
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    fireEvent.click(view.getByRole("option", { name: "Deck B" }));
    expect(lastInner().chains[0]?.effects[0]).toMatchObject({
      sidechain: { channelId: "deck-b" },
    });
    fireEvent.click(view.getByRole("switch", { name: "Compressor enabled" }));
    expect(lastInner().chains[0]?.effects[0]?.enabled).toBe(
      !compressor.enabled
    );
    expect(
      view
        .getByRole("button", { name: "Compressor" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Compressor" }));
    expect(view.queryByRole("slider", { name: "Threshold" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Compressor" }));
    expect(
      view.getByRole("combobox", { name: "Sidechain input" }).textContent
    ).toContain("Deck B");
    fireEvent.click(view.getByRole("button", { name: "Remove Compressor" }));
    updated = lastInner();
    expect(updated.chains[0]?.effects).toEqual([{ ...gate, order: 0 }]);
    expect(view.queryByRole("button", { name: "Compressor" })).toBeNull();
  });

  test("nested containers retain the depth limit through the shared renderer", () => {
    const root = composite("root", [composite("inner", [])]);
    const view = render(
      <EffectParams
        depth={MAX_EFFECT_TREE_DEPTH - 2}
        effect={root}
        onUpdate={noop}
      />
    );
    fireEvent.click(view.getByRole("button", { name: "FX Composite" }));
    const addButtons = view.getAllByRole("button", {
      name: "Add nested effect",
    });
    // The inner container is at depth 7: leaves remain allowed, containers do not.
    fireEvent.click(addButtons[0] as HTMLElement);
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(
      view.queryByRole("button", {
        name: (name) => name.startsWith("Stereo Split"),
      })
    ).toBeNull();
    expect(
      view.getByRole("button", {
        name: (name) => name.startsWith("Compressor "),
      })
    ).toBeTruthy();
    cleanup();
    const atLimit = render(
      <EffectParams
        depth={MAX_EFFECT_TREE_DEPTH - 1}
        effect={root}
        onUpdate={noop}
      />
    );
    fireEvent.click(atLimit.getByRole("button", { name: "FX Composite" }));
    // Only the two root chains can add effects; the inner chains are at depth 8.
    expect(
      atLimit.getAllByRole("button", { name: "Add nested effect" })
    ).toHaveLength(2);
  });
});

describe("ParamSlider", () => {
  function drag(slider: HTMLElement, type: string, clientY: number) {
    fireEvent(
      slider,
      new dom.window.PointerEvent(type, {
        bubbles: true,
        buttons: 1,
        cancelable: true,
        clientY,
        pointerId: 1,
      })
    );
  }

  test("frequency knobs sweep logarithmically, so bass is a short drag away", () => {
    const onChange = mock((_value: number) => undefined);
    const view = render(
      <ParamSlider
        defaultValue={20}
        formatKey="frequency"
        label="Freq"
        max={20_000}
        min={20}
        onChange={onChange}
        step={1}
        value={20}
      />
    );
    const slider = view.getByRole("slider", { name: "Freq" });

    drag(slider, "pointerdown", 200);
    drag(slider, "pointermove", 190);

    const [value] = onChange.mock.calls.at(-1) ?? [];
    expect(value).toBeGreaterThan(20);
    expect(value).toBeLessThan(200);
  });
});
