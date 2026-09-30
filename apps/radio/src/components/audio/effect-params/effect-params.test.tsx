/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { EffectConfig } from "@/lib/audio";

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
const { cleanup, render } = await import("@testing-library/react");

let EffectParams: typeof import("./effect-params")["EffectParams"];
let createDefaultEffectConfig: typeof import("@/lib/audio/dsp/effects/registry")["createDefaultEffectConfig"];

beforeAll(async () => {
  ({ EffectParams } = await import("./effect-params"));
  ({ createDefaultEffectConfig } = await import(
    "@/lib/audio/dsp/effects/registry"
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
