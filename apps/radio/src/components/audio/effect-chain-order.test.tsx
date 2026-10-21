import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: intercept the DnD boundary while rendering the real context.
import * as dnd from "@dnd-kit/core";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { installAnimationTestEnvironment } from "@/components/radio/dj/shared/animation-test-utils";
import { createDefaultEffectConfig } from "@/lib/audio";
import { EffectChain } from "./effect-chain";

let clock: ReturnType<typeof installAnimationTestEnvironment>;
beforeEach(() => {
  clock = installAnimationTestEnvironment();
});
afterEach(() => {
  cleanup();
  clock.restore();
});
const ignore = () => undefined;
const gate = createDefaultEffectConfig("gate", "gate", 0);
const limiter = createDefaultEffectConfig("limiter", "limiter", 1);

function chain(effects = [gate, limiter], onReorderEffects = ignore) {
  return (
    <EffectChain
      effects={effects}
      onAddEffect={ignore}
      onRemoveEffect={ignore}
      onReorderEffects={onReorderEffects}
      onUpdateEffect={ignore}
    />
  );
}

function order(container: HTMLElement) {
  return [...container.querySelectorAll('[aria-label^="Reorder "]')].map(
    (element) => element.getAttribute("aria-label")
  );
}

test("external reorders with the same IDs replace the displayed order", () => {
  const view = render(chain());
  const initial = order(view.container);
  view.rerender(chain([limiter, gate]));
  expect(order(view.container)).toEqual([...initial].reverse());
});

test("an optimistic drag waits for acknowledgement, then follows external reorders", () => {
  const original = dnd.DndContext;
  let dragEnd: dnd.DndContextProps["onDragEnd"];
  const intercept = spyOn(dnd, "DndContext").mockImplementation(
    Object.assign(
      (props: dnd.DndContextProps) => {
        dragEnd = props.onDragEnd;
        return createElement(original, props);
      },
      { $$typeof: original.$$typeof }
    )
  );
  try {
    const onReorder = mock(ignore);
    const view = render(chain([gate, limiter], onReorder));
    const initial = order(view.container);
    act(() =>
      dragEnd?.({
        active: { id: "gate" },
        over: { id: "limiter" },
      } as dnd.DragEndEvent)
    );
    expect(onReorder).toHaveBeenCalledWith(["limiter", "gate"]);
    expect(order(view.container)).toEqual([...initial].reverse());
    view.rerender(chain([{ ...gate, enabled: false }, limiter], onReorder));
    expect(order(view.container)).toEqual([...initial].reverse());
    view.rerender(chain([limiter, gate], onReorder));
    view.rerender(chain([gate, limiter], onReorder));
    expect(order(view.container)).toEqual(initial);
  } finally {
    intercept.mockRestore();
  }
});
