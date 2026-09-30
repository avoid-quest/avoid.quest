import { describe, expect, mock, test } from "bun:test";
import {
  type DeviceInputAudio,
  startDeviceInput,
} from "./device-input-playback";

function createAudio(channelCount: number | null = 2) {
  const calls: string[] = [];
  const audio: DeviceInputAudio = {
    getDeviceChannelCount: mock(() => channelCount),
    setDeviceChannelSelection: mock((soundId, selection) => {
      calls.push(`select ${soundId} ${selection.left}:${selection.right}`);
    }),
    startDevice: mock((soundId, deviceId, ...rest) => {
      calls.push(`start ${soundId} ${deviceId} ${JSON.stringify(rest)}`);
      return Promise.resolve();
    }),
  };
  return { audio, calls };
}

describe("startDeviceInput", () => {
  test("opens the capture, then selects its channels, and reports the count", async () => {
    const { audio, calls } = createAudio(4);

    const count = await startDeviceInput(audio, "deck", {
      channelSelection: { left: 2, right: 3 },
      deviceId: "interface",
    });

    expect(count).toBe(4);
    expect(calls).toEqual(["start deck interface []", "select deck 2:3"]);
  });

  test("asks for echo cancellation only when it is set", async () => {
    const { audio, calls } = createAudio();

    await startDeviceInput(audio, "node:n:mic", {
      channelSelection: { left: 0, right: 1 },
      deviceId: "mic",
      echoCancellation: true,
    });

    expect(calls[0]).toBe('start node:n:mic mic [{"echoCancellation":true}]');
  });

  test("a start gone stale while the capture opened selects nothing", async () => {
    const { audio, calls } = createAudio();

    const count = await startDeviceInput(
      audio,
      "deck",
      { channelSelection: { left: 0, right: 1 }, deviceId: "interface" },
      () => false
    );

    expect(count).toBeNull();
    expect(calls).toEqual(["start deck interface []"]);
  });
});
