/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, describe, expect, jest, test } from "bun:test";
import { Knob } from "@avoid.quest/ui/components/knob";
import { Slider } from "@avoid.quest/ui/components/slider";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createRef, useState } from "react";
import { MixerCrossfader } from "@/components/radio/dj/mixer/mixer-crossfader";
import { ChannelSlider } from "@/components/radio/dj/shared/channel-slider";
import { getEffectParamDefs } from "@/lib/audio/dsp/effects/schema";
import { ParamSlider } from "./effect-params/param-slider";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ResizeObserverStub {
  observe() {
    // JSDOM does not perform layout.
  }
  unobserve() {
    // JSDOM does not perform layout.
  }
  disconnect() {
    // JSDOM does not perform layout.
  }
}

for (const [key, value] of Object.entries({
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  ResizeObserver: ResizeObserverStub,
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

const { act, cleanup, render } = await import("@testing-library/react");
afterEach(cleanup);

function wheel(element: Element, deltaY: number, ctrlKey = false) {
  const event = new dom.window.WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey,
    deltaY,
  });
  act(() => element.dispatchEvent(event));
  return event;
}

function pressKey(element: Element, name: string, shiftKey = false) {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey,
  });
  act(() => element.dispatchEvent(event));
  return event;
}

function requireElement(container: HTMLElement, selector: string) {
  const element = container.querySelector(selector);
  if (!element) {
    throw new Error(`Missing control ${selector}`);
  }
  return element;
}

describe("fine control wheel changes", () => {
  test("knob uses .01 units despite a coarse drag step, logarithmic sweep and default snap", () => {
    const changes: number[] = [];
    const control = (value: number) => (
      <Knob
        defaultValue={1}
        max={2}
        min={0.5}
        onChange={(next) => changes.push(next)}
        scale="log"
        step={0.5}
        value={value}
      />
    );
    const view = render(control(1));
    const knob = requireElement(view.container, '[role="slider"]');

    expect(wheel(knob, -120).defaultPrevented).toBe(true);
    wheel(knob, -120);
    view.rerender(control(1.01)); // A delayed acknowledgement of the first tick.
    wheel(knob, -120);
    expect(changes).toEqual([1.01, 1.02, 1.03]);
    view.rerender(control(1.5)); // An external edit replaces pending wheel input.
    wheel(knob, 120);
    expect(changes.at(-1)).toBe(1.49);
  });

  test("continuous slider wheel bypasses its coarse drag step and commits each seek", () => {
    const changes: number[][] = [];
    const commits: number[][] = [];
    const view = render(
      <Slider
        max={10}
        min={0}
        onValueChange={(next) => changes.push(next)}
        onValueCommit={(next) => commits.push(next)}
        step={1}
        value={[5]}
      />
    );
    const slider = requireElement(view.container, '[data-slot="slider"]');
    wheel(slider, -120);
    wheel(slider, -120);
    wheel(slider, 120);
    expect(changes).toEqual([[5.01], [5.02], [5.01]]);
    expect(commits).toEqual(changes);
  });

  test("uncontrolled slider displays repeated fine wheel changes", () => {
    const ref = createRef<HTMLSpanElement>();
    const view = render(
      <Slider defaultValue={[0.5]} max={1} min={0} ref={ref} step={0.1} />
    );
    const slider = requireElement(view.container, '[data-slot="slider"]');
    expect(ref.current === slider).toBe(true);
    wheel(slider, -1);
    wheel(slider, -1);
    expect(
      requireElement(view.container, '[role="slider"]').getAttribute(
        "aria-valuenow"
      )
    ).toBe("0.52");
  });

  test("clamps values and leaves disabled, zoom and bound-only scrolling alone", () => {
    const changes: number[] = [];
    const renderKnob = (disabled = false) => (
      <Knob
        disabled={disabled}
        max={1}
        min={0}
        onChange={(next) => changes.push(next)}
        value={0.995}
      />
    );
    const view = render(renderKnob());
    const knob = requireElement(view.container, '[role="slider"]');
    wheel(knob, -1);
    expect(changes).toEqual([1]);
    expect(wheel(knob, -1).defaultPrevented).toBe(false);
    expect(wheel(knob, 1, true).defaultPrevented).toBe(false);
    view.rerender(renderKnob(true));
    expect(wheel(knob, 1).defaultPrevented).toBe(false);
    expect(changes).toEqual([1]);
  });

  test("wheel respects discrete steps and the targeted thumb's allowed range", () => {
    const changes: number[][] = [];
    const view = render(
      <Slider
        max={16}
        min={1}
        minStepsBetweenThumbs={1}
        onValueChange={(next) => changes.push(next)}
        step={1}
        value={[8, 10]}
        wheelStep={1}
      />
    );
    const thumbs = view.container.querySelectorAll(
      '[data-slot="slider-thumb"]'
    );
    const [, second] = thumbs;
    if (!second) {
      throw new Error("Missing second thumb");
    }
    wheel(second, 1);
    wheel(second, 1);
    expect(changes).toEqual([[8, 9]]);
    expect(
      getEffectParamDefs("crusher").find((param) => param.key === "bitDepth")
    ).toMatchObject({ wheelStep: 1 });
  });

  test("discrete effect knobs retain whole values instead of being rounded back after every tick", () => {
    const changes: number[] = [];
    const view = render(
      <ParamSlider
        label="Bits"
        max={16}
        min={1}
        onChange={(next) => changes.push(next)}
        step={1}
        value={8.3}
        wheelStep={1}
      />
    );
    wheel(requireElement(view.container, '[role="slider"]'), -1);
    expect(changes).toEqual([9]);
  });

  test("a reset replaces pending wheel input before the next wheel tick", () => {
    const changes: number[] = [];
    const view = render(
      <Knob
        defaultValue={0.5}
        max={1}
        min={0}
        onChange={(next) => changes.push(next)}
        value={0.5}
      />
    );
    const knob = requireElement(view.container, '[role="slider"]');
    wheel(knob, -1);
    act(() =>
      knob.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true, button: 0 })
      )
    );
    wheel(knob, -1);
    expect(changes).toEqual([0.51, 0.5, 0.51]);
  });

  test("fader snapping remains separate from fine wheel input", () => {
    const changes: number[][] = [];
    const view = render(
      <Slider
        defaultValue={[1]}
        max={1.585}
        min={0}
        onValueChange={(next) => changes.push(next)}
        snapToDefault
        step={0.01}
        value={[1]}
      />
    );
    const thumb = requireElement(view.container, '[role="slider"]');
    act(() =>
      thumb.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowUp",
        })
      )
    );
    expect(changes).toEqual([[1]]);
    wheel(thumb, -1);
    expect(changes.at(-1)).toEqual([1.01]);
  });

  test("DJ crossfader preserves wheel precision at the centre", () => {
    const changes: number[] = [];
    const view = render(
      <MixerCrossfader
        crossfadePosition={0.5}
        onCrossfadeChange={(next) => changes.push(next)}
      />
    );
    const slider = requireElement(view.container, '[data-slot="slider"]');
    wheel(slider, -1);
    wheel(slider, -1);
    expect(changes).toEqual([0.5001, 0.5002]);
  });

  test("channel wrapper does not resnap rapid fine changes back to its default", () => {
    const changes: number[] = [];
    const view = render(
      <ChannelSlider
        defaultValue={0}
        formatValue={String}
        label="Pan"
        max={1}
        min={-1}
        onChange={(next) => changes.push(next)}
        step={0.01}
        value={0}
      />
    );
    const knob = requireElement(view.container, '[role="slider"]');
    wheel(knob, -1);
    wheel(knob, -1);
    wheel(knob, -1);
    expect(changes).toEqual([0.01, 0.02, 0.03]);
  });
});

describe("immediate control input with throttled audio updates", () => {
  test("every effect knob arrow press is displayed while only the latest trailing value reaches audio", async () => {
    const audioChanges: number[] = [];
    function Harness() {
      const [value, setValue] = useState(0);
      return (
        <ParamSlider
          label="Mix"
          max={1}
          min={0}
          onChange={(next) => {
            audioChanges.push(next);
            setValue(next);
          }}
          step={0.1}
          value={value}
        />
      );
    }
    const view = render(<Harness />);
    const knob = requireElement(view.container, '[role="slider"]');
    act(() => {
      for (let index = 0; index < 5; index += 1) {
        knob.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "ArrowUp",
          })
        );
      }
    });
    expect(audioChanges).toEqual([0.1]);
    expect(knob.getAttribute("aria-valuenow")).toBe("0.5");
    await act(() => Bun.sleep(50));
    expect(audioChanges).toEqual([0.1, 0.5]);
    expect(knob.getAttribute("aria-valuenow")).toBe("0.5");
  });

  test("channel arrow input survives earlier acknowledgements and preserves keyboard limits", () => {
    const changes: number[] = [];
    const control = (value: number) => (
      <ChannelSlider
        defaultValue={0}
        formatValue={String}
        label="Pan"
        max={1}
        min={-1}
        onChange={(next) => changes.push(next)}
        step={0.25}
        value={value}
      />
    );
    const view = render(control(0));
    const knob = requireElement(view.container, '[role="slider"]');
    pressKey(knob, "ArrowUp");
    pressKey(knob, "ArrowRight");
    pressKey(knob, "ArrowUp");
    expect(changes).toEqual([0.25, 0.5, 0.75]);
    view.rerender(control(0.25));
    expect(knob.getAttribute("aria-valuenow")).toBe("0.75");
    pressKey(knob, "ArrowLeft", true);
    expect(changes.at(-1)).toBe(0.55);
    pressKey(knob, "End");
    pressKey(knob, "ArrowUp");
    expect(changes.at(-1)).toBe(1);
    pressKey(knob, "Home");
    expect(changes.at(-1)).toBe(-1);
    view.rerender(control(-0.5)); // An unrelated MIDI/edit value replaces local intent.
    pressKey(knob, "ArrowRight");
    expect(changes.at(-1)).toBe(-0.25);
  });

  test("wheel, keys, reset and the next drag share intent despite delayed earlier values", () => {
    const changes: number[] = [];
    const control = (value: number) => (
      <Knob
        defaultValue={0.5}
        max={1}
        min={0}
        onChange={(next) => changes.push(next)}
        step={0.1}
        value={value}
      />
    );
    const view = render(control(0.5));
    const knob = requireElement(view.container, '[role="slider"]');
    Object.defineProperty(knob, "setPointerCapture", {
      value: () => undefined,
    });
    wheel(knob, -1);
    pressKey(knob, "ArrowUp");
    act(() =>
      knob.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true, button: 0 })
      )
    );
    view.rerender(control(0.51));
    expect(knob.getAttribute("aria-valuenow")).toBe("0.5");
    pressKey(knob, "ArrowUp");
    act(() => {
      knob.dispatchEvent(
        new dom.window.PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientY: 100,
          pointerId: 1,
        })
      );
      knob.dispatchEvent(
        new dom.window.PointerEvent("pointermove", {
          bubbles: true,
          clientY: 82,
          pointerId: 1,
        })
      );
    });
    view.rerender(control(0.61));
    expect(knob.getAttribute("aria-valuenow")).toBe("0.7");
    pressKey(knob, "ArrowDown");
    expect(changes).toEqual([0.51, 0.61, 0.5, 0.6, 0.7, 0.6]);
  });

  test("requests the parent never renders expire before a matching external value", () => {
    jest.useFakeTimers();
    try {
      const changes: number[] = [];
      const control = (value: number) => (
        <Knob
          max={1}
          min={0}
          onChange={(next) => changes.push(next)}
          value={value}
        />
      );
      const view = render(control(0.51));
      const knob = requireElement(view.container, '[role="slider"]');
      wheel(knob, -1);
      wheel(knob, 1); // Back to 0.51, so the parent skips both renders.
      act(() => {
        jest.advanceTimersByTime(500);
      });
      view.rerender(control(0.52)); // An external MIDI edit, not an echo.
      expect(knob.getAttribute("aria-valuenow")).toBe("0.52");
      wheel(knob, -1);
      expect(changes).toEqual([0.52, 0.51, 0.53]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("slider keys use immediate wheel and reset values while controlled props lag", () => {
    const changes: number[][] = [];
    const control = (value: number) => (
      <Slider
        max={1}
        min={0}
        onValueChange={(next) => changes.push(next)}
        resetValue={[0.5]}
        step={0.1}
        value={[value]}
      />
    );
    const view = render(control(0.5));
    const thumb = requireElement(view.container, '[role="slider"]');
    pressKey(thumb, "ArrowUp");
    pressKey(thumb, "ArrowUp");
    pressKey(thumb, "ArrowUp");
    expect(changes).toEqual([[0.6], [0.7], [0.8]]);
    wheel(thumb, -1);
    pressKey(thumb, "ArrowDown");
    expect(changes.at(-1)).toEqual([0.7]); // Ordinary keys preserve the legal drag step.
    act(() =>
      thumb.dispatchEvent(
        new dom.window.MouseEvent("dblclick", { bubbles: true, button: 0 })
      )
    );
    view.rerender(control(0.6));
    expect(thumb.getAttribute("aria-valuenow")).toBe("0.5");
    pressKey(thumb, "ArrowUp");
    expect(changes.at(-1)).toEqual([0.6]);
  });
});
