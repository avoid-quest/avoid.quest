/** biome-ignore-all lint/performance/noJsxPropsBind: Controlled test harness records changes and updates React state */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { Knob } from "@avoid.quest/ui/components/knob";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  navigator: dom.window.navigator,
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

afterEach(cleanup);

type KnobProps = Parameters<typeof Knob>[0];

function renderKnob(
  disabled = false,
  props: Omit<KnobProps, "onChange" | "value"> = {
    defaultValue: 0,
    label: "Pan",
    max: 1,
    min: -1,
  }
) {
  const onChange = mock((_value: number) => undefined);
  function Harness() {
    const [value, setValue] = useState(props.defaultValue ?? props.min);
    function handleChange(next: number) {
      onChange(next);
      setValue(next);
    }
    return (
      <Knob
        {...props}
        disabled={disabled}
        onChange={handleChange}
        value={value}
      />
    );
  }
  const view = render(<Harness />);
  const slider = view.getByRole("slider", { name: props.label });
  const setPointerCapture = mock((_pointerId: number) => undefined);
  Object.defineProperty(slider, "setPointerCapture", {
    value: setPointerCapture,
  });
  return { onChange, setPointerCapture, slider };
}

function pointer(
  slider: HTMLElement,
  type: string,
  pointerId: number,
  clientY: number,
  buttons = 1
) {
  fireEvent(
    slider,
    new dom.window.PointerEvent(type, {
      bubbles: true,
      buttons,
      cancelable: true,
      clientY,
      pointerId,
    })
  );
}

describe("Knob pointer ownership", () => {
  test.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "stops after %s and allows a fresh drag",
    (endEvent) => {
      const { onChange, slider } = renderKnob();
      pointer(slider, "pointermove", 1, 100, 0);
      expect(onChange).not.toHaveBeenCalled();

      pointer(slider, "pointerdown", 1, 100);
      pointer(slider, "pointermove", 1, 82);
      expect(slider.getAttribute("aria-valuenow")).toBe("0.2");

      pointer(slider, endEvent, 1, 82, 0);
      pointer(slider, "pointermove", 1, 64, 0);
      pointer(slider, "pointermove", 2, 46);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(slider.getAttribute("aria-valuenow")).toBe("0.2");

      pointer(slider, "pointerdown", 2, 100);
      pointer(slider, "pointermove", 2, 82);
      expect(slider.getAttribute("aria-valuenow")).toBe("0.4");
      expect(onChange).toHaveBeenCalledTimes(2);
    }
  );

  test.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "ignores a second pointer's down, move and %s during a drag",
    (endEvent) => {
      const { onChange, setPointerCapture, slider } = renderKnob();
      pointer(slider, "pointerdown", 1, 100);
      pointer(slider, "pointerdown", 2, 20);
      pointer(slider, "pointermove", 2, 2);
      expect(onChange).not.toHaveBeenCalled();
      expect(setPointerCapture).toHaveBeenCalledTimes(1);
      expect(setPointerCapture).toHaveBeenCalledWith(1);

      pointer(slider, endEvent, 2, 2, 0);
      pointer(slider, "pointermove", 1, 82);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(slider.getAttribute("aria-valuenow")).toBe("0.2");
    }
  );

  test("preserves keyboard nudges, limits and the default reset after cancellation", () => {
    const { onChange, slider } = renderKnob();
    pointer(slider, "pointerdown", 1, 100);
    pointer(slider, "pointercancel", 1, 100, 0);

    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.01");
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    expect(slider.getAttribute("aria-valuenow")).toBe("-0.19");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.getAttribute("aria-valuenow")).toBe("-1");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.doubleClick(slider);
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  test("keeps disabled knobs inert", () => {
    const { onChange, setPointerCapture, slider } = renderKnob(true);
    pointer(slider, "pointerdown", 1, 100);
    pointer(slider, "pointermove", 1, 82);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.doubleClick(slider);
    expect(onChange).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });
});

describe("Knob snapping", () => {
  const frequency = {
    defaultValue: 20,
    label: "Freq",
    max: 20_000,
    min: 20,
    scale: "log",
    step: 1,
  } as const;

  test("a log knob snaps to its default only within a sliver of the sweep", () => {
    const { slider } = renderKnob(false, frequency);
    pointer(slider, "pointerdown", 1, 200);
    pointer(slider, "pointermove", 1, 199);
    expect(slider.getAttribute("aria-valuenow")).toBe("20");

    // Five pixels up is a few hertz, not a snap back to 20 Hz.
    pointer(slider, "pointermove", 1, 195);
    const value = Number(slider.getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThan(20);
    expect(value).toBeLessThan(30);
  });

  test("a linear knob still snaps to its default as it nears it", () => {
    const { slider } = renderKnob();
    pointer(slider, "pointerdown", 1, 100);
    pointer(slider, "pointermove", 1, 99);
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    pointer(slider, "pointermove", 1, 95);
    expect(slider.getAttribute("aria-valuenow")).toBe("0.06");
  });
});
