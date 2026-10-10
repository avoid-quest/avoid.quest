import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

class TestAudioParam {
  readonly setTargetAtTime = () => undefined;
}

class TestAudioNode {
  readonly context: TestAudioContext;

  constructor(context: TestAudioContext) {
    this.context = context;
  }

  readonly connect = () => undefined;

  readonly disconnect = () => undefined;
}

class TestDelayNode extends TestAudioNode {
  readonly delayTime = new TestAudioParam();
}

class TestGainNode extends TestAudioNode {
  readonly gain = new TestAudioParam();
}

class TestAudioContext {
  readonly currentTime = 0;
  readonly destination = new TestAudioNode(this);
  onstatechange: (() => void) | null = null;
  readonly state = "running";

  close(): Promise<void> {
    return Promise.resolve();
  }

  createDelay(): TestDelayNode {
    return new TestDelayNode(this);
  }

  createGain(): TestGainNode {
    return new TestGainNode(this);
  }

  setSinkId(): Promise<void> {
    return Promise.resolve();
  }
}

let getAudioSettings: typeof import("./collections/settings")["getAudioSettings"];
let getOutputRouting: typeof import("./output-routing")["getOutputRouting"];
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://radio.test",
  });
  for (const [key, value] of Object.entries({
    AudioContext: TestAudioContext,
    AudioNode: TestAudioNode,
    AudioParam: TestAudioParam,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    window: dom.window,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
    });
  }

  const settings = await import("./collections/settings");
  ({ getOutputRouting } = await import("./output-routing"));
  ({ getAudioSettings } = settings);
  await settings.initializeSettings();
});

afterAll(async () => {
  getOutputRouting().cleanup();
  const { AudioContextManager } = await import(
    "./audio/playback/audio-context"
  );
  AudioContextManager.resetForTesting();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

describe("persisted Output routing", () => {
  test("persists the first main output selection", async () => {
    await expect(
      getOutputRouting().applyMainSettings({ mainOutputId: "speakers" })
    ).resolves.toMatchObject({
      settings: { mainOutputId: "speakers" },
    });
    expect(getAudioSettings().mainOutputId).toBe("speakers");
  });
});
