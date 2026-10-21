/** biome-ignore-all lint/performance/noJsxPropsBind: Harness provides changing canvas draw inputs. */
import { expect, mock, test } from "bun:test";
import { installSettingsTestDom } from "../../settings/settings-test-dom";

if (process.env.AVOID_QUEST_CANVAS_REGRESSION) {
  installSettingsTestDom();
  const { act, render } = await import("@testing-library/react");
  const { useCanvasDraw } = await import("./use-canvas-draw");
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: (id: number) => frames.delete(id),
  });
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) {
      callback(0);
    }
  };
  let resize: (
    entries: { contentRect: { width: number; height: number } }[]
  ) => void = () => undefined;
  const observe = mock(() => undefined);
  const disconnect = mock(() => undefined);
  const construct = mock(() => undefined);
  class ResizeObserverStub {
    constructor(callback: typeof resize) {
      resize = callback;
      construct();
    }
    observe = observe;
    disconnect = disconnect;
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  let resolutionChanged: () => void = () => undefined;
  const removeListener = mock(() => undefined);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: (_event: string, callback: () => void) => {
        resolutionChanged = callback;
      },
      removeEventListener: removeListener,
    }),
  });

  test("parameter/theme redraws share observers and a frame; only size/DPR resizes the bitmap", async () => {
    const draw = mock((_input: number) => undefined);
    function Harness({ input }: { input: number }) {
      const ref = useCanvasDraw(() => draw(input));
      return <canvas ref={ref} />;
    }
    // Install the context before the hook's mount effect runs.
    const transform = mock(() => undefined);
    const context = { setTransform: transform };
    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => context,
    });
    const view = render(<Harness input={1} />);
    const canvas = view.container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing canvas");
    }
    let width = 0;
    let height = 0;
    const setWidth = mock((value: number) => {
      width = value;
    });
    const setHeight = mock((value: number) => {
      height = value;
    });
    Object.defineProperties(canvas, {
      height: { get: () => height, set: setHeight },
      width: { get: () => width, set: setWidth },
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1,
    });
    resize([{ contentRect: { height: 50, width: 100 } }]);
    flush();
    expect([width, height]).toEqual([100, 50]);
    expect(draw).toHaveBeenLastCalledWith(1);
    view.rerender(<Harness input={2} />);
    view.rerender(<Harness input={3} />);
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(frames.size).toBe(1);
    flush();
    expect(draw).toHaveBeenLastCalledWith(3);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(construct).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(setWidth).toHaveBeenCalledTimes(1);
    expect(setHeight).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    resolutionChanged();
    flush();
    expect([width, height]).toEqual([200, 100]);
    expect(setWidth).toHaveBeenCalledTimes(2);
    resize([{ contentRect: { height: 50, width: 120 } }]);
    flush();
    expect([width, height]).toEqual([240, 100]);
    expect(setHeight).toHaveBeenCalledTimes(2);
    view.rerender(<Harness input={4} />);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalled();
  });
} else {
  test("canvas draw lifecycle regression (isolated browser globals)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_CANVAS_REGRESSION: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 20_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode ? stderr : "", exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 25_000);
}
