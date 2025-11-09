import { AudioBuffer } from "standardized-audio-context-mock";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";

import { Playback } from "./playback";
import { audioContextMock, cacophony } from "./setupTests";
import type { Sound } from "./sound";
import { Synth } from "./synth";
import { SynthPlayback } from "./synth-playback";

beforeAll(() => {
  jest.useFakeTimers();
});

describe("Synth event system", () => {
  let synth: Synth;

  beforeEach(() => {
    synth = new Synth({
      context: audioContextMock,
      globalGainNode: audioContextMock.createGain(),
    });
  });

  it("emits play event when synth is played", async () =>
    new Promise<void>((resolve) => {
      synth.on("play", (playback) => {
        expect(playback).toBeInstanceOf(SynthPlayback);
        resolve();
      });
      synth.play();
    }));

  it("emits stop event when synth is stopped", () =>
    new Promise<void>((resolve) => {
      synth.on("stop", () => {
        expect(synth.isPlaying).toBe(false);
        resolve();
      });
      synth.play();
      synth.stop();
    }));

  it("emits pause event when synth is paused", () =>
    new Promise<void>((resolve) => {
      synth.on("pause", () => {
        expect(synth.isPlaying).toBe(false);
        resolve();
      });
      synth.play();
      synth.pause();
    }));

  it("emits frequencyChange event when frequency is changed", () =>
    new Promise<void>((resolve) => {
      synth.on("frequencyChange", (freq) => {
        expect(freq).toBe(880);
        resolve();
      });
      synth.frequency = 880;
    }));

  it("emits detuneChange event when detune is changed", () =>
    new Promise<void>((resolve) => {
      synth.on("detuneChange", (detune) => {
        expect(detune).toBe(100);
        resolve();
      });
      synth.detune = 100;
    }));

  it("emits typeChange event when oscillator type is changed", () =>
    new Promise<void>((resolve) => {
      synth.on("typeChange", (type) => {
        expect(type).toBe("square");
        resolve();
      });
      synth.type = "square";
    }));

  it("can remove event listeners", () => {
      const listener = mock();
    synth.on("play", listener);
    synth.off("play", listener);
    synth.play();
    expect(listener).not.toHaveBeenCalled();
  });

  it("handles multiple listeners for the same event", () => {
      const listener1 = mock();
      const listener2 = mock();
    synth.on("play", listener1);
    synth.on("play", listener2);
    synth.play();
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});

afterAll(() => {
  jest.useRealTimers();
});

describe("Event system", () => {
  let sound: Sound;
  let buffer: AudioBuffer;

  beforeEach(async () => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    sound = await cacophony.createSound(buffer);
  });

  it("emits play event when sound is played", async () =>
    new Promise<void>((resolve) => {
      sound.on("play", (playback) => {
        expect(playback).toBeInstanceOf(Playback);
        resolve();
      });
      sound.play();
    }));

  it("emits stop event when sound is stopped", () =>
    new Promise<void>((resolve) => {
      sound.on("stop", () => {
        expect(sound.isPlaying).toBe(false);
        resolve();
      });
      sound.play();
      sound.stop();
    }));

  it("emits pause event when sound is paused", () =>
    new Promise<void>((resolve) => {
      sound.on("pause", () => {
        expect(sound.isPlaying).toBe(false);
        resolve();
      });
      sound.play();
      sound.pause();
    }));

  it("emits volumeChange event when volume is changed", () =>
    new Promise<void>((resolve) => {
      sound.on("volumeChange", (volume) => {
        expect(volume).toBe(0.5);
        resolve();
      });
      sound.volume = 0.5;
    }));

  it("emits rateChange event when playback rate is changed", () =>
    new Promise<void>((resolve) => {
      sound.on("rateChange", (rate) => {
        expect(rate).toBe(1.5);
        resolve();
      });
      sound.playbackRate = 1.5;
    }));

  it("can remove event listeners", () => {
      const listener = mock();
    sound.on("play", listener);
    sound.off("play", listener);
    sound.play();
    expect(listener).not.toHaveBeenCalled();
  });

  it("handles multiple listeners for the same event", () => {
      const listener1 = mock();
      const listener2 = mock();
    sound.on("play", listener1);
    sound.on("play", listener2);
    sound.play();
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});
