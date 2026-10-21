import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { installAnimationTestEnvironment } from "@/components/radio/dj/shared/animation-test-utils";
import { AudioManager } from "@/lib/audio";
import { refreshTrackProgress } from "./track-progress-state";
import { useTrackProgress } from "./use-track-progress";

let clock: ReturnType<typeof installAnimationTestEnvironment>;
let sample: ReturnType<typeof spyOn<AudioManager, "getTrackProgress">>;
beforeEach(() => {
  clock = installAnimationTestEnvironment();
  sample = spyOn(
    AudioManager.getInstance(),
    "getTrackProgress"
  ).mockReturnValue({ duration: 100, position: 10 });
});
afterEach(() => {
  cleanup();
  sample.mockRestore();
  clock.restore();
});

test("paused progress schedules no frames and refreshes on seek", () => {
  const renders = mock(() => undefined);
  const view = renderHook(() => {
    renders();
    return useTrackProgress("paused", false);
  });
  const baseline = renders.mock.calls.length;
  for (let i = 0; i < 60; i += 1) {
    act(() => clock.advance(1000 / 60));
  }
  expect(clock.frames.size).toBe(0);
  expect(renders.mock.calls.length).toBe(baseline);
  expect(sample).toHaveBeenCalledTimes(1);
  sample.mockReturnValue({ duration: 100, position: 40 });
  act(() => refreshTrackProgress("paused"));
  expect(view.result.current.position).toBe(40);
  expect(clock.frames.size).toBe(0);
});

test("identical samples do not commit and hidden/source-less transports stop polling", () => {
  const renders = mock(() => undefined);
  const view = renderHook(
    ({ visible, soundId }) => {
      renders();
      return useTrackProgress(soundId, true, visible);
    },
    { initialProps: { soundId: "playing" as string | null, visible: true } }
  );
  const baseline = renders.mock.calls.length;
  for (let i = 0; i < 8; i += 1) {
    act(() => clock.advance(250));
  }
  expect(sample.mock.calls.length).toBeGreaterThan(1);
  expect(renders.mock.calls.length).toBe(baseline);
  view.rerender({ soundId: "playing", visible: false });
  expect(clock.frames.size).toBe(0);
  view.rerender({ soundId: null, visible: true });
  expect(view.result.current).toEqual({ duration: 0, position: 0 });
  expect(clock.frames.size).toBe(0);
});

test("a paused source refreshes when preparation finishes", () => {
  const view = renderHook(
    ({ ready }) => useTrackProgress("prepared", false, true, ready),
    { initialProps: { ready: false } }
  );
  expect(sample).not.toHaveBeenCalled();
  view.rerender({ ready: true });
  expect(sample).toHaveBeenCalledTimes(1);
  expect(view.result.current.position).toBe(10);
  expect(clock.frames.size).toBe(0);
});
