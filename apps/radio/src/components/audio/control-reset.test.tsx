/** biome-ignore-all lint/performance/noJsxPropsBind: Controlled gesture harness updates state and records callbacks */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { Knob } from "@avoid.quest/ui/components/knob";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

class ObserverStub {
  observe() {
    // Layout measurements are unnecessary for thumb gesture tests.
  }
  unobserve() {
    // No measurements to release.
  }
  disconnect() {
    // No measurements to release.
  }
}

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
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

function renderControl(kind: "knob" | "slider", disabled = false) {
  const onChange = mock((_value: number) => undefined);
  const onCommit = mock((_values: number[]) => undefined);
  function Harness() {
    const [value, setValue] = useState(0.7);
    function handleChange(next: number) {
      setValue(next);
      onChange(next);
    }
    return kind === "knob" ? (
      <Knob
        defaultValue={0.5}
        disabled={disabled}
        label="Level"
        max={1}
        min={0}
        onChange={handleChange}
        value={value}
      />
    ) : (
      <Slider
        aria-label="Level"
        defaultValue={[0.5]}
        disabled={disabled}
        max={1}
        min={0}
        onValueChange={([next]) => handleChange(next ?? 0)}
        onValueCommit={onCommit}
        step={0.01}
        value={[value]}
      />
    );
  }
  const view = render(<Harness />);
  const control = view.getByRole("slider", { name: "Level" });
  const root = control.closest('[data-slot="slider"]');
  if (root) {
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ height: 100, left: 0, top: 0, width: 100 }),
    });
  }
  let captured: number | null = null;
  const setPointerCapture = mock((id: number) => {
    captured = id;
  });
  Object.defineProperties(control, {
    hasPointerCapture: { value: (id: number) => captured === id },
    releasePointerCapture: {
      value: () => {
        captured = null;
      },
    },
    setPointerCapture: { value: setPointerCapture },
  });
  return { control, onChange, onCommit, setPointerCapture };
}

function pointer(
  control: HTMLElement,
  type: string,
  {
    pointerId = 1,
    clientX = 50,
    clientY = 100,
    time = 100,
    ...options
  }: Partial<PointerEventInit> & { time?: number } = {}
) {
  const event = new dom.window.PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    ...options,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  fireEvent(control, event);
}

describe.each(["knob", "slider"] as const)("%s reset gestures", (kind) => {
  test("double-click resets the controlled value", () => {
    const { control, onChange, onCommit } = renderControl(kind);
    fireEvent.doubleClick(control);
    expect(control.getAttribute("aria-valuenow")).toBe("0.5");
    expect(onChange).toHaveBeenCalledWith(0.5);
    if (kind === "slider") {
      expect(onCommit).toHaveBeenCalledWith([0.5]);
    }
  });

  test("Ctrl + primary click resets without starting a drag", () => {
    const { control, onChange, setPointerCapture } = renderControl(kind);
    pointer(control, "pointerdown", { ctrlKey: true });
    pointer(control, "pointermove", { clientY: 82 });
    pointer(control, "pointerup", { clientY: 82 });
    expect(control.getAttribute("aria-valuenow")).toBe("0.5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).not.toHaveBeenCalled();
    const contextMenu = new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    fireEvent(control, contextMenu);
    expect(contextMenu.defaultPrevented).toBeTrue();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("two completed touch taps reset before the second drag begins", () => {
    const { control, onChange, setPointerCapture } = renderControl(kind);
    pointer(control, "pointerdown", { pointerType: "touch" });
    pointer(control, "pointerup", { pointerType: "touch", time: 120 });
    pointer(control, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      time: 200,
    });
    pointer(control, "pointermove", {
      clientY: 70,
      pointerId: 2,
      pointerType: "touch",
      time: 220,
    });
    expect(control.getAttribute("aria-valuenow")).toBe("0.5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(setPointerCapture).toHaveBeenCalledTimes(1);
  });

  test.each(["pointercancel", "lostpointercapture"])(
    "a %s does not count as the first tap",
    (end) => {
      const { control, onChange } = renderControl(kind);
      pointer(control, "pointerdown", { pointerType: "touch" });
      pointer(control, end, { pointerType: "touch", time: 120 });
      pointer(control, "pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        time: 200,
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(control.getAttribute("aria-valuenow")).toBe("0.7");
    }
  );

  test("a touch drag does not count as a reset tap", () => {
    const { control, onChange } = renderControl(kind);
    pointer(control, "pointerdown", { pointerType: "touch" });
    pointer(control, "pointermove", {
      clientY: 82,
      pointerType: "touch",
      time: 110,
    });
    pointer(control, "pointerup", {
      clientY: 82,
      pointerType: "touch",
      time: 120,
    });
    const changeCount = onChange.mock.calls.length;
    pointer(control, "pointerdown", {
      clientY: 82,
      pointerId: 2,
      pointerType: "touch",
      time: 200,
    });
    expect(onChange).toHaveBeenCalledTimes(changeCount);
  });

  test("long presses and taps separated in time are not double taps", () => {
    const { control, onChange } = renderControl(kind);
    pointer(control, "pointerdown", { pointerType: "touch" });
    pointer(control, "pointerup", { pointerType: "touch", time: 500 });
    pointer(control, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      time: 600,
    });
    pointer(control, "pointerup", {
      pointerId: 2,
      pointerType: "touch",
      time: 620,
    });
    pointer(control, "pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      time: 1000,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("disabled controls ignore all reset gestures", () => {
    const { control, onChange, onCommit } = renderControl(kind, true);
    pointer(control, "pointerdown", { ctrlKey: true });
    pointer(control, "pointerdown", { pointerType: "touch" });
    pointer(control, "pointerup", { pointerType: "touch", time: 120 });
    pointer(control, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      time: 200,
    });
    fireEvent.doubleClick(control);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("ordinary keyboard and Shift-click gestures keep their behavior", () => {
    const { control, onChange } = renderControl(kind);
    pointer(control, "pointerdown", { shiftKey: true });
    pointer(control, "pointerup", { shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(control.getAttribute("aria-valuenow")).toBe("0.71");
  });
});

test("Slider uses an explicit reset target and supports uncontrolled resets", () => {
  const onCommit = mock((_values: number[]) => undefined);
  const view = render(
    <Slider
      aria-label="Position"
      defaultValue={[30]}
      max={100}
      min={0}
      onValueCommit={onCommit}
      resetValue={[0]}
    />
  );
  const control = view.getByRole("slider", { name: "Position" });
  fireEvent.keyDown(control, { key: "ArrowRight" });
  expect(control.getAttribute("aria-valuenow")).toBe("31");
  fireEvent.doubleClick(control);
  expect(control.getAttribute("aria-valuenow")).toBe("0");
  expect(onCommit).toHaveBeenLastCalledWith([0]);
});

test("Slider resets only the thumb a gesture lands on", () => {
  const changes: number[][] = [];
  function Range() {
    const [value, setValue] = useState([20, 80]);
    return (
      <Slider
        aria-label="Range"
        defaultValue={[0, 100]}
        max={100}
        min={0}
        onValueChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        value={value}
      />
    );
  }
  const view = render(<Range />);
  const [low, high] = view.getAllByRole("slider", { name: "Range" });
  if (!(low && high)) {
    throw new Error("expected two thumbs");
  }
  fireEvent.doubleClick(high);
  expect(changes.at(-1)).toEqual([20, 100]);
  pointer(low, "pointerdown", { ctrlKey: true });
  expect(changes.at(-1)).toEqual([0, 100]);
});
