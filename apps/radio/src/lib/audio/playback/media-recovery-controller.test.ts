import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import {
  MAX_RECONNECT_DELAY_MS,
  MediaRecoveryController,
  reconnectDelayMs,
} from "./media-recovery-controller.js";

afterEach(() => {
  jest.useRealTimers();
});

describe("MediaRecoveryController", () => {
  test("uses capped exponential retry without a second timer", () => {
    expect(
      Array.from({ length: 9 }, (_, index) => reconnectDelayMs(index))
    ).toEqual([0, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(reconnectDelayMs(100)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  test("preserves the absolute stall epoch across watchdog and retry phases", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    const recovery = new MediaRecoveryController();
    const watchdog = mock(() => undefined);
    const retry = mock(() => undefined);
    recovery.noteStall(new Error("waiting"));
    expect(recovery.scheduleWatchdog(6000, watchdog)).toBe(true);

    jest.advanceTimersByTime(6000);
    expect(watchdog).toHaveBeenCalledTimes(1);
    recovery.noteStall(new Error("still waiting"));
    expect(recovery.stalledDuration()).toBe(6000);
    expect(recovery.scheduleRetry(retry)).toBe(true);
    jest.advanceTimersByTime(0);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(recovery.stalledDuration()).toBe(6000);

    recovery.markRecovered();
    expect(recovery.error).toBeNull();
    expect(recovery.stalledDuration()).toBe(0);
  });

  test("suspends timers offline without resetting the recovery epoch", () => {
    jest.useFakeTimers();
    const recovery = new MediaRecoveryController();
    const callback = mock(() => undefined);
    recovery.noteStall(new Error("offline"), 100);
    recovery.scheduleWatchdog(6000, callback);

    recovery.suspend();
    jest.advanceTimersByTime(6000);

    expect(callback).not.toHaveBeenCalled();
    expect(recovery.error?.message).toBe("offline");
    expect(recovery.stalledDuration(6100)).toBe(6000);
  });
});
