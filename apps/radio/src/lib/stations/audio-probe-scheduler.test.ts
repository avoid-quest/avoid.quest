import { describe, expect, test } from "bun:test";
import {
  createAudioProbePool,
  createAudioProbeScheduler,
  createGlobalAudioProbeScheduler,
} from "./audio-probe-scheduler.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("audio probe scheduler", () => {
  test("globally bounds probes submitted by independent search clients", async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const releases: Array<() => void> = [];
    const firstClient = createGlobalAudioProbeScheduler();
    const secondClient = createGlobalAudioProbeScheduler();
    const run = () =>
      new Promise<void>((resolve) => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        releases.push(() => {
          activeCount -= 1;
          resolve();
        });
      });
    const tasks = Array.from({ length: 8 }, (_, index) =>
      (index % 2 === 0 ? firstClient : secondClient)(run)
    );
    let settled = false;
    Promise.all(tasks).finally(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(activeCount).toBe(2);
    while (!settled) {
      for (const release of releases.splice(0)) {
        release();
      }
      await flushMicrotasks();
    }
    await Promise.all(tasks);

    expect(maxActiveCount).toBe(2);
  });

  test("uses one shared slot on constrained connections", async () => {
    const pool = createAudioProbePool(() => 1);
    const firstClient = pool.forSignal();
    const secondClient = pool.forSignal();
    let activeCount = 0;
    let maxActiveCount = 0;
    const tasks = Array.from({ length: 6 }, (_, index) =>
      (index % 2 === 0 ? firstClient : secondClient)(async () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await Promise.resolve();
        activeCount -= 1;
      })
    );

    await Promise.all(tasks);

    expect(maxActiveCount).toBe(1);
  });

  test("aborts only the queued work owned by one request", async () => {
    const pool = createAudioProbePool(() => 1);
    const blocker = pool.forSignal();
    const canceledController = new AbortController();
    const canceledClient = pool.forSignal(canceledController.signal);
    const survivingClient = pool.forSignal();
    let release: () => void = () => undefined;
    const first = blocker(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const canceled = canceledClient(() => Promise.resolve("canceled"));
    const surviving = survivingClient(() => Promise.resolve("surviving"));

    canceledController.abort(new DOMException("Superseded", "AbortError"));
    release();

    await expect(canceled).rejects.toHaveProperty("name", "AbortError");
    await expect(first).resolves.toBeUndefined();
    await expect(surviving).resolves.toBe("surviving");
  });

  test("retains an active slot until a non-cooperative probe settles", async () => {
    const controller = new AbortController();
    const pool = createAudioProbePool(() => 1);
    const activeClient = pool.forSignal(controller.signal);
    const nextClient = pool.forSignal();
    let release: () => void = () => undefined;
    let nextStarted = false;
    const active = activeClient(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await flushMicrotasks();
    const next = nextClient(() => {
      nextStarted = true;
      return Promise.resolve();
    });

    controller.abort();
    await expect(active).rejects.toHaveProperty("name", "AbortError");
    await flushMicrotasks();
    expect(nextStarted).toBe(false);

    release();
    await next;
    expect(nextStarted).toBe(true);
  });

  test("releases a slot when a probe throws synchronously", async () => {
    const scheduler = createAudioProbeScheduler(1);

    await expect(
      scheduler(() => {
        throw new Error("synchronous probe failure");
      })
    ).rejects.toThrow("synchronous probe failure");
    await expect(scheduler(() => Promise.resolve("next"))).resolves.toBe(
      "next"
    );
  });
});
