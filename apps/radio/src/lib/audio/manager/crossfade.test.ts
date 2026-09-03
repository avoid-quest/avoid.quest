import { beforeEach, describe, expect, mock, test } from "bun:test";

const manager = {
  getSoundVolume: mock((_soundId: string) => 1),
  hasSound: mock((_soundId: string) => true),
  scheduleVolumeCurve: mock(
    (_soundId: string, _curve: Float32Array, _duration: number) => undefined
  ),
  setVolume: mock((_soundId: string, _volume: number) => undefined),
  stopSound: mock((_soundId: string) => undefined),
};

mock.module("./audio-manager.js", () => ({
  AudioManager: {
    getInstance: () => manager,
  },
}));

const { crossfade, fadeOut } = await import("./crossfade");

describe("crossfade utilities", () => {
  beforeEach(() => {
    manager.getSoundVolume.mockClear();
    manager.hasSound.mockClear();
    manager.scheduleVolumeCurve.mockClear();
    manager.setVolume.mockClear();
    manager.stopSound.mockClear();
    manager.hasSound.mockImplementation((_soundId: string) => true);
    manager.getSoundVolume.mockImplementation((_soundId: string) => 1);
  });

  test("crossfade schedules a single automation curve per sound", async () => {
    manager.getSoundVolume.mockImplementation((soundId: string) =>
      soundId === "incoming" ? 0 : 0.6
    );

    await crossfade("outgoing", "incoming", {
      curve: "equalPower",
      duration: 1,
      targetVolume: 0.8,
    });

    expect(manager.scheduleVolumeCurve).toHaveBeenCalledTimes(2);
    expect(manager.scheduleVolumeCurve).toHaveBeenNthCalledWith(
      1,
      "outgoing",
      expect.any(Float32Array),
      1
    );
    expect(manager.scheduleVolumeCurve).toHaveBeenNthCalledWith(
      2,
      "incoming",
      expect.any(Float32Array),
      1
    );
    expect(manager.setVolume).not.toHaveBeenCalled();
    expect(manager.stopSound).toHaveBeenCalledWith("outgoing");
  });

  test("uses complementary cosine and sine equal-power curves", async () => {
    manager.getSoundVolume.mockImplementation((soundId: string) =>
      soundId === "incoming" ? 0 : 1
    );

    await crossfade("outgoing", "incoming", {
      curve: "equalPower",
      duration: 1,
      targetVolume: 1,
    });

    const outgoing = manager.scheduleVolumeCurve.mock.calls[0]?.[1];
    const incoming = manager.scheduleVolumeCurve.mock.calls[1]?.[1];
    expect(outgoing?.[24]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(incoming?.[24]).toBeCloseTo(Math.SQRT1_2, 5);
    expect((outgoing?.[24] ?? 0) ** 2 + (incoming?.[24] ?? 0) ** 2).toBeCloseTo(
      1,
      5
    );
  });

  test("can leave outgoing lifecycle ownership to a transaction", async () => {
    await crossfade("outgoing", "incoming", {
      duration: 1,
      stopOutgoing: false,
    });

    expect(manager.stopSound).not.toHaveBeenCalled();
  });

  test("aborts by restoring both sounds without stopping the outgoing sound", async () => {
    manager.getSoundVolume.mockImplementation((soundId: string) =>
      soundId === "incoming" ? 0 : 0.7
    );
    const controller = new AbortController();
    const transition = crossfade("outgoing", "incoming", {
      duration: 100,
      signal: controller.signal,
    });

    controller.abort(new DOMException("Superseded", "AbortError"));

    await expect(transition).rejects.toHaveProperty("name", "AbortError");
    expect(manager.setVolume).toHaveBeenCalledWith("outgoing", 0.7);
    expect(manager.setVolume).toHaveBeenCalledWith("incoming", 0);
    expect(manager.stopSound).not.toHaveBeenCalled();
  });

  test("crossfade directly sets final volumes only for zero duration", async () => {
    await crossfade("outgoing", "incoming", {
      curve: "equalPower",
      duration: 0,
      targetVolume: 0.18,
    });

    expect(manager.scheduleVolumeCurve).not.toHaveBeenCalled();
    expect(manager.setVolume).toHaveBeenCalledWith("outgoing", 0);
    expect(manager.setVolume).toHaveBeenCalledWith("incoming", 0.18);
    expect(manager.stopSound).toHaveBeenCalledWith("outgoing");
  });

  test("fadeOut exits cleanly if the sound disappears before completion", async () => {
    let hasSoundCalls = 0;
    manager.hasSound.mockImplementation((_soundId: string) => {
      hasSoundCalls += 1;
      return hasSoundCalls < 2;
    });

    await fadeOut("outgoing", 1, true);

    expect(manager.scheduleVolumeCurve).toHaveBeenCalledTimes(1);
    expect(manager.stopSound).not.toHaveBeenCalled();
  });
});
