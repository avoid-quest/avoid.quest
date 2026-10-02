import { describe, expect, test } from "bun:test";
import { createPendingChannelStarts } from "./pending-channel-starts";

describe("pending channel starts", () => {
  test("pausing one channel suppresses its late resolution and leaves another owned", async () => {
    const starts = createPendingChannelStarts();
    const resolution = Promise.withResolvers<void>();
    const paused = starts.begin("n:paused");
    const playing = starts.begin("n:playing");
    const completed: string[] = [];
    const finish = async (channelId: string, start: typeof paused) => {
      try {
        await resolution.promise;
        if (start.isCurrent()) {
          completed.push(channelId);
        }
      } finally {
        start.release();
      }
    };
    const pausedResolution = finish("n:paused", paused);
    const playingResolution = finish("n:playing", playing);

    starts.cancel("n:paused");
    resolution.resolve();
    await Promise.all([pausedResolution, playingResolution]);

    expect(completed).toEqual(["n:playing"]);
  });

  test("bulk pause cancels existing starts but a subsequent user start remains owned", () => {
    const starts = createPendingChannelStarts();
    const first = starts.begin("n:first");
    const second = starts.begin("n:second");

    starts.cancel();
    const resumed = starts.begin("n:first");

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(false);
    expect(resumed.isCurrent()).toBe(true);
  });

  test("release before an intentional source replacement retains caller ownership checks", () => {
    const starts = createPendingChannelStarts();
    let sourceIsCurrent = true;
    const start = starts.begin("n:track", () => sourceIsCurrent);

    start.release();
    starts.cancel("n:track");
    expect(start.isCurrent()).toBe(true);

    sourceIsCurrent = false;
    expect(start.isCurrent()).toBe(false);
  });

  test("releasing a cancelled start repeatedly cannot revive its continuation", () => {
    const starts = createPendingChannelStarts();
    const start = starts.begin("n:track");

    starts.cancel("n:track");
    start.release();
    start.release();

    expect(start.isCurrent()).toBe(false);
  });
});
