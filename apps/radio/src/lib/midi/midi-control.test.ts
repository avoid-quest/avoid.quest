import { describe, expect, mock, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import {
  createMidiControl,
  type MidiBrowserAccess,
  type MidiBrowserAdapter,
  type MidiBrowserInput,
  type MidiControlChange,
  type MidiMappingPersistence,
  type PersistedMidiControl,
} from "./midi-control";
import { createStaticMidiActions } from "./static-actions";
import type { MidiAction, MidiMapping, MidiTransform } from "./types";

const mapping: MidiMapping = {
  channel: 0,
  control: 7,
  type: "cc",
  targetId: "deck-a:volume",
};

class MemoryPersistence implements MidiMappingPersistence {
  value: PersistedMidiControl | null;

  constructor(value: PersistedMidiControl | null = null) {
    this.value = value;
  }

  read(): PersistedMidiControl | null {
    return this.value;
  }

  write(value: PersistedMidiControl): void {
    this.value = value;
  }
}

const unsupportedBrowser: MidiBrowserAdapter = {
  cancelFrame: () => undefined,
  isSupported: () => false,
  now: () => 100,
  requestAccess: () => Promise.reject(new Error("unsupported")),
  requestFrame: () => 1,
  subscribePermission: () => () => undefined,
};

class FakeBrowser implements MidiBrowserAdapter {
  private deviceState: "connected" | "disconnected" = "connected";
  private frame: (() => void) | null = null;
  private readonly messageListeners = new Set<(data: Uint8Array) => void>();
  private readonly permissionListeners = new Set<
    (permission: "denied" | "granted" | "prompt") => void
  >();
  private readonly stateListeners = new Set<() => void>();
  time = 100;

  private readonly input: MidiBrowserInput;

  constructor() {
    const browser = this;
    this.input = {
      get device() {
        return {
          id: "input-1",
          manufacturer: "Test",
          name: "Test MIDI",
          state: browser.deviceState,
          type: "input" as const,
        };
      },
      subscribe: (listener) => {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
      },
    };
  }

  private readonly access: MidiBrowserAccess = {
    inputs: () => [this.input],
    subscribeStateChange: (listener) => {
      this.stateListeners.add(listener);
      return () => this.stateListeners.delete(listener);
    },
  };

  cancelFrame(): void {
    this.frame = null;
  }

  emit(data: number[]): void {
    for (const listener of this.messageListeners) {
      listener(Uint8Array.from(data));
    }
  }

  flushFrame(): void {
    const frame = this.frame;
    this.frame = null;
    frame?.();
  }

  get messageListenerCount(): number {
    return this.messageListeners.size;
  }

  get hasPendingFrame(): boolean {
    return this.frame !== null;
  }

  get stateListenerCount(): number {
    return this.stateListeners.size;
  }

  isSupported(): boolean {
    return true;
  }

  now(): number {
    return this.time;
  }

  requestAccess(): Promise<MidiBrowserAccess> {
    return Promise.resolve(this.access);
  }

  requestFrame(callback: () => void): number {
    this.frame = callback;
    return 1;
  }

  subscribePermission(
    listener: (permission: "denied" | "granted" | "prompt") => void
  ): () => void {
    this.permissionListeners.add(listener);
    return () => this.permissionListeners.delete(listener);
  }

  setDeviceState(state: "connected" | "disconnected"): void {
    this.deviceState = state;
    for (const listener of this.stateListeners) {
      listener();
    }
  }

  setPermission(permission: "denied" | "granted" | "prompt"): void {
    for (const listener of this.permissionListeners) {
      listener(permission);
    }
  }
}

class DeferredMidiAccess implements MidiBrowserAccess {
  private readonly deviceState: "connected" | "disconnected" = "connected";
  private readonly messageListeners = new Set<(data: Uint8Array) => void>();
  private readonly stateListeners = new Set<() => void>();
  private readonly input: MidiBrowserInput;

  constructor(id: string) {
    const access = this;
    this.input = {
      get device() {
        return {
          id,
          manufacturer: "Test",
          name: id,
          state: access.deviceState,
          type: "input" as const,
        };
      },
      subscribe: (listener) => {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
      },
    };
  }

  get messageListenerCount(): number {
    return this.messageListeners.size;
  }

  get stateListenerCount(): number {
    return this.stateListeners.size;
  }

  inputs(): readonly MidiBrowserInput[] {
    return [this.input];
  }

  subscribeStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
}

class DeferredBrowser implements MidiBrowserAdapter {
  private readonly accessResolvers: Array<(access: MidiBrowserAccess) => void> =
    [];

  cancelFrame(): void {
    return;
  }

  isSupported(): boolean {
    return true;
  }

  now(): number {
    return 100;
  }

  requestAccess(): Promise<MidiBrowserAccess> {
    return new Promise((resolve) => this.accessResolvers.push(resolve));
  }

  requestFrame(): number {
    return 1;
  }

  resolveAccess(index: number, access: MidiBrowserAccess): void {
    const resolve = this.accessResolvers[index];
    if (!resolve) {
      throw new Error(`Missing MIDI access request ${index}`);
    }
    resolve(access);
  }

  subscribePermission(): () => void {
    return () => undefined;
  }
}

describe("MidiControl", () => {
  test("synchronizes mapping transforms with target lookup and persistence", () => {
    const persistence = new MemoryPersistence({
      state: { activePresetId: "custom", enabled: true, mappings: [mapping] },
      version: 2,
    });
    const control = createMidiControl({
      browser: unsupportedBrowser,
      persistence,
      staticActions: [],
    });

    control.change({
      type: "update-transform",
      targetId: mapping.targetId,
      patch: { invert: true },
    });

    const updated = control
      .getSnapshot()
      .mappingsByTarget.get(mapping.targetId);
    expect(updated?.transform?.invert).toBe(true);
    if (!updated) {
      throw new Error("Expected the mapping transform to be updated");
    }
    expect(persistence.value?.state.mappings).toEqual([updated]);
    expect(persistence.value?.state.activePresetId).toBe("custom");
  });

  test("applies mapping transforms at the active DJ dispatch boundary", async () => {
    const normalized = 64 / 127;
    const cases: {
      expected: number;
      transform?: MidiTransform;
    }[] = [
      { expected: normalized },
      {
        expected: 1 - normalized,
        transform: { curve: "linear", invert: true, max: 1, min: 0 },
      },
      {
        expected: 0.2 + normalized * 0.6,
        transform: { curve: "linear", invert: false, max: 0.8, min: 0.2 },
      },
      {
        expected: Math.log1p(normalized * (Math.E - 1)),
        transform: { curve: "log", invert: false, max: 1, min: 0 },
      },
      {
        expected: (Math.exp(normalized) - 1) / (Math.E - 1),
        transform: { curve: "exp", invert: false, max: 1, min: 0 },
      },
    ];

    for (const testCase of cases) {
      const browser = new FakeBrowser();
      const values: number[] = [];
      const action: MidiAction = {
        dispatch: (value) => values.push(value),
        group: "deck-a",
        label: "Volume",
        targetId: mapping.targetId,
        type: "continuous",
      };
      const control = createMidiControl({
        browser,
        persistence: new MemoryPersistence({
          state: {
            activePresetId: null,
            enabled: true,
            mappings: [{ ...mapping, transform: testCase.transform }],
          },
          version: 2,
        }),
        staticActions: [action],
      });

      control.activateDj();
      await control.connect();
      browser.emit([0xb0, 7, 64]);
      browser.flushFrame();

      expect(values[0]).toBeCloseTo(testCase.expected, 10);
    }
  });

  test("learn mode replaces a target mapping and persists it", async () => {
    const browser = new FakeBrowser();
    const persistence = new MemoryPersistence({
      state: { activePresetId: "preset", enabled: false, mappings: [mapping] },
      version: 2,
    });
    const control = createMidiControl({
      browser,
      persistence,
      staticActions: [],
    });

    control.change({ type: "start-learn", targetId: mapping.targetId });
    await control.connect();
    browser.emit([0xb0, 9, 127]);

    expect(control.getSnapshot().learningTarget).toBeNull();
    expect(control.getSnapshot().mappings).toEqual([
      { ...mapping, control: 9 },
    ]);
    expect(persistence.value?.state).toEqual({
      activePresetId: null,
      enabled: false,
      mappings: [{ ...mapping, control: 9 }],
    });
  });

  test("suppresses disabled dispatch and resumes with retained mappings", async () => {
    const browser = new FakeBrowser();
    const values: number[] = [];
    const persistence = new MemoryPersistence({
      state: { activePresetId: null, enabled: false, mappings: [mapping] },
      version: 2,
    });
    const control = createMidiControl({
      browser,
      persistence,
      staticActions: [
        {
          dispatch: (value) => values.push(value),
          group: "deck-a",
          label: "Volume",
          targetId: mapping.targetId,
          type: "continuous",
        },
      ],
    });

    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 7, 32]);
    browser.flushFrame();
    control.change({ type: "set-enabled", enabled: true });
    browser.emit([0xb0, 7, 96]);
    browser.flushFrame();

    expect(values).toEqual([96 / 127]);
    expect(control.getSnapshot().mappings).toEqual([mapping]);
    expect(persistence.value?.state.enabled).toBe(true);
  });

  test("revokes queued dispatch when MIDI or DJ ownership deactivates", async () => {
    const setup = async () => {
      const browser = new FakeBrowser();
      const dispatch = mock(() => undefined);
      const control = createMidiControl({
        browser,
        persistence: new MemoryPersistence({
          state: { activePresetId: null, enabled: true, mappings: [mapping] },
          version: 2,
        }),
        staticActions: [
          {
            dispatch,
            group: "deck-a",
            label: "Volume",
            targetId: mapping.targetId,
            type: "continuous",
          },
        ],
      });
      const deactivate = control.activateDj();
      await control.connect();
      browser.emit([0xb0, 7, 127]);
      return { browser, control, deactivate, dispatch };
    };

    const disabled = await setup();
    disabled.control.change({ type: "set-enabled", enabled: false });
    expect(disabled.browser.hasPendingFrame).toBe(false);
    disabled.browser.flushFrame();
    expect(disabled.dispatch).not.toHaveBeenCalled();
    expect(disabled.control.getSnapshot().mappings).toEqual([mapping]);

    const deactivated = await setup();
    deactivated.deactivate();
    expect(deactivated.browser.hasPendingFrame).toBe(false);
    deactivated.browser.flushFrame();
    expect(deactivated.dispatch).not.toHaveBeenCalled();
    expect(deactivated.control.getSnapshot().mappings).toEqual([mapping]);
  });

  test("cancels queued dispatch before every mapping transaction", async () => {
    const transactions: MidiControlChange[] = [
      {
        patch: { invert: true },
        targetId: mapping.targetId,
        type: "update-transform",
      },
      { targetId: mapping.targetId, type: "remove-mapping" },
      { type: "clear-mappings" },
      { presetId: "generic-2-deck", type: "load-preset" },
    ];

    for (const transaction of transactions) {
      const browser = new FakeBrowser();
      const dispatch = mock(() => undefined);
      const control = createMidiControl({
        browser,
        persistence: new MemoryPersistence({
          state: { activePresetId: null, enabled: true, mappings: [mapping] },
          version: 2,
        }),
        staticActions: [
          {
            dispatch,
            group: "deck-a",
            label: "Volume",
            targetId: mapping.targetId,
            type: "continuous",
          },
        ],
      });
      control.activateDj();
      await control.connect();
      browser.emit([0xb0, 7, 127]);

      control.change(transaction);

      expect(browser.hasPendingFrame).toBe(false);
      browser.flushFrame();
      expect(dispatch).not.toHaveBeenCalled();
    }

    const browser = new FakeBrowser();
    const dispatch = mock(() => undefined);
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: { activePresetId: null, enabled: true, mappings: [mapping] },
        version: 2,
      }),
      staticActions: [
        {
          dispatch,
          group: "deck-a",
          label: "Volume",
          targetId: mapping.targetId,
          type: "continuous",
        },
      ],
    });
    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 7, 127]);
    control.change({ type: "start-learn", targetId: mapping.targetId });
    browser.emit([0xb0, 9, 127]);

    expect(browser.hasPendingFrame).toBe(false);
    browser.flushFrame();
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("reattaches once when a MIDI input reconnects", async () => {
    const browser = new FakeBrowser();
    const values: number[] = [];
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: { activePresetId: null, enabled: true, mappings: [mapping] },
        version: 2,
      }),
      staticActions: [
        {
          dispatch: (value) => values.push(value),
          group: "deck-a",
          label: "Volume",
          targetId: mapping.targetId,
          type: "continuous",
        },
      ],
    });

    control.activateDj();
    await control.connect();
    browser.setDeviceState("disconnected");
    expect(control.getSnapshot().devices[0]?.state).toBe("disconnected");
    browser.setDeviceState("connected");
    browser.setDeviceState("connected");
    browser.emit([0xb0, 7, 127]);
    browser.flushFrame();

    expect(control.getSnapshot().devices[0]?.state).toBe("connected");
    expect(values).toEqual([1]);
  });

  test("keeps reconnect observation after an idempotent connect replay", async () => {
    const browser = new FakeBrowser();
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence(),
      staticActions: [],
    });

    await control.connect();
    await control.connect();
    browser.setDeviceState("disconnected");

    expect(control.getSnapshot().devices[0]?.state).toBe("disconnected");
    expect(browser.messageListenerCount).toBe(1);
    expect(browser.stateListenerCount).toBe(1);
  });

  test("dispatches static actions through DJ Deck and composite mixer commands", async () => {
    const browser = new FakeBrowser();
    const transport = mock(() => Promise.resolve());
    const change = mock(() => undefined);
    let persistedHeadphoneVolume = 1;
    let runtimeHeadphoneVolume = 1;
    const setHeadphoneVolume = mock((volume: number) => {
      persistedHeadphoneVolume = volume;
      runtimeHeadphoneVolume = volume;
    });
    const staticActions = createStaticMidiActions({
      decks: {
        deck: () => ({ change, load: mock(), transport }),
      },
      setCrossfadePosition: mock(),
      setHeadphoneVolume,
      setMasterVolume: mock(),
    });
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 11,
              targetId: "deck-a:play-pause",
              type: "note",
            },
            {
              channel: 0,
              control: 12,
              targetId: "mixer:headphone-volume",
              type: "cc",
            },
          ],
        },
        version: 2,
      }),
      staticActions,
    });

    control.activateDj();
    await control.connect();
    browser.emit([0x90, 11, 127]);
    browser.emit([0xb0, 12, 64]);
    browser.flushFrame();

    expect(transport).toHaveBeenCalledWith({ type: "toggle" });
    expect(setHeadphoneVolume).toHaveBeenCalledWith(64 / 127);
    expect(runtimeHeadphoneVolume).toBe(64 / 127);
    expect(persistedHeadphoneVolume).toBe(64 / 127);
    expect(change).not.toHaveBeenCalled();
  });

  test("resolves the current DJ Deck handle for every static dispatch", async () => {
    const browser = new FakeBrowser();
    const firstTransport = mock(() => Promise.resolve());
    const replacementTransport = mock(() => Promise.resolve());
    const firstDeck = {
      change: mock(),
      load: mock(),
      transport: firstTransport,
    };
    const replacementDeck = {
      change: mock(),
      load: mock(),
      transport: replacementTransport,
    };
    let currentDeck = firstDeck;
    const staticActions = createStaticMidiActions({
      decks: {
        deck: () => currentDeck,
      },
      setCrossfadePosition: mock(),
      setHeadphoneVolume: mock(),
      setMasterVolume: mock(),
    });
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 11,
              targetId: "deck-a:play-pause",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      staticActions,
    });

    control.activateDj();
    await control.connect();
    browser.emit([0x90, 11, 127]);
    currentDeck = replacementDeck;
    browser.time = 151;
    browser.emit([0x90, 11, 127]);

    expect(firstTransport).toHaveBeenCalledTimes(1);
    expect(replacementTransport).toHaveBeenCalledTimes(1);
  });

  test("registers Effect actions and mutates through ChannelEffects", async () => {
    const browser = new FakeBrowser();
    const limiter = createDefaultEffectConfig("limiter", "limiter", 0);
    limiter.enabled = false;
    const effectChange = mock(async () => ({
      desired: {
        dryWet: 1,
        sidechainSoundId: null,
        tempo: 120,
        tree: [{ ...limiter, enabled: true }],
      },
      runtime: { backend: null, ready: false, status: "inactive" as const },
    }));
    const control = createMidiControl({
      browser,
      effects: { change: effectChange },
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 21,
              targetId: "deck-a:effect:limiter:enabled",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      staticActions: [],
    });
    const binding = control.bindDeckEffects("deck-a");
    binding.reconcile([limiter]);

    control.activateDj();
    await control.connect();
    browser.emit([0x90, 21, 127]);
    await Promise.resolve();

    expect(effectChange).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      { effectId: "limiter", patch: { enabled: true }, type: "update" }
    );
    expect(
      control
        .getSnapshot()
        .actions.some(
          (action) => action.targetId === "deck-a:effect:limiter:enabled"
        )
    ).toBe(true);
  });

  test("keeps a newer external Effect reconcile after an older MIDI change settles", async () => {
    const browser = new FakeBrowser();
    const limiter = createDefaultEffectConfig("limiter", "limiter", 0);
    limiter.enabled = false;
    const staleResult = {
      desired: {
        dryWet: 1,
        sidechainSoundId: null,
        tempo: 120,
        tree: [{ ...limiter, enabled: true }],
      },
      runtime: { backend: null, ready: false, status: "inactive" as const },
    };
    const deferred = Promise.withResolvers<typeof staleResult>();
    const effectChange = mock(() => deferred.promise);
    const control = createMidiControl({
      browser,
      effects: { change: effectChange },
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 21,
              targetId: "deck-a:effect:limiter:enabled",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      staticActions: [],
    });
    const binding = control.bindDeckEffects("deck-a");
    binding.reconcile([limiter]);
    control.activateDj();
    await control.connect();
    browser.emit([0x90, 21, 127]);
    await Promise.resolve();
    expect(effectChange).toHaveBeenCalledTimes(1);

    const delay = createDefaultEffectConfig("delay", "new-delay", 0);
    binding.reconcile([delay]);
    deferred.resolve(staleResult);
    await deferred.promise;
    await Promise.resolve();

    const targets = control
      .getSnapshot()
      .actions.map((action) => action.targetId);
    expect(targets).toContain("deck-a:effect:new-delay:enabled");
    expect(targets).not.toContain("deck-a:effect:limiter:enabled");
  });

  test("discards a deferred Effect rejection after cleanup", async () => {
    const browser = new FakeBrowser();
    const limiter = createDefaultEffectConfig("limiter", "limiter", 0);
    limiter.enabled = false;
    const deferred = Promise.withResolvers<never>();
    const effectChange = mock(() => deferred.promise);
    const control = createMidiControl({
      browser,
      effects: { change: effectChange },
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 21,
              targetId: "deck-a:effect:limiter:enabled",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      staticActions: [],
    });
    const binding = control.bindDeckEffects("deck-a");
    binding.reconcile([limiter]);
    control.activateDj();
    await control.connect();
    browser.emit([0x90, 21, 127]);
    await Promise.resolve();
    expect(effectChange).toHaveBeenCalledTimes(1);

    control.cleanup();
    const cleanedSnapshot = control.getSnapshot();
    deferred.reject(new Error("late Effect failure"));
    await deferred.promise.catch(() => undefined);
    await Promise.resolve();

    expect(control.getSnapshot()).toBe(cleanedSnapshot);
    expect(control.getSnapshot().error).toBeNull();
  });

  test("filters note-off and contact bounce for button actions", async () => {
    const browser = new FakeBrowser();
    const dispatch = mock(() => undefined);
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 11,
              targetId: "deck-a:play-pause",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      staticActions: [
        {
          dispatch,
          group: "deck-a",
          label: "Play/Pause",
          targetId: "deck-a:play-pause",
          type: "button",
        },
      ],
    });

    control.activateDj();
    await control.connect();
    browser.emit([0x90, 11, 127]);
    browser.time = 110;
    browser.emit([0x90, 11, 127]);
    browser.emit([0x80, 11, 127]);
    browser.time = 151;
    browser.emit([0x90, 11, 127]);

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  test("cleans up listeners and pending dispatch idempotently", async () => {
    const browser = new FakeBrowser();
    const dispatch = mock(() => undefined);
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: { activePresetId: null, enabled: true, mappings: [mapping] },
        version: 2,
      }),
      staticActions: [
        {
          dispatch,
          group: "deck-a",
          label: "Volume",
          targetId: mapping.targetId,
          type: "continuous",
        },
      ],
    });

    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 7, 127]);
    control.cleanup();
    control.cleanup();
    browser.flushFrame();
    browser.emit([0xb0, 7, 64]);

    expect(dispatch).not.toHaveBeenCalled();
    expect(browser.messageListenerCount).toBe(0);
    expect(browser.stateListenerCount).toBe(0);
    expect(control.getSnapshot().devices).toEqual([]);
    expect(control.getSnapshot().djActive).toBe(false);
  });

  test("discards deferred MIDI access that settles after cleanup", async () => {
    const browser = new DeferredBrowser();
    const staleAccess = new DeferredMidiAccess("stale-input");
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence(),
      staticActions: [],
    });
    const pending = control.connect();

    control.cleanup();
    const cleanedSnapshot = control.getSnapshot();
    browser.resolveAccess(0, staleAccess);
    await pending;

    expect(control.getSnapshot()).toBe(cleanedSnapshot);
    expect(control.getSnapshot().status).toBe("prompt");
    expect(control.getSnapshot().devices).toEqual([]);
    expect(staleAccess.messageListenerCount).toBe(0);
    expect(staleAccess.stateListenerCount).toBe(0);
  });

  test("keeps a newer MIDI connection when an older request settles", async () => {
    const browser = new DeferredBrowser();
    const staleAccess = new DeferredMidiAccess("stale-input");
    const currentAccess = new DeferredMidiAccess("current-input");
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence(),
      staticActions: [],
    });
    const staleConnect = control.connect();
    control.cleanup();
    const currentConnect = control.connect();

    browser.resolveAccess(1, currentAccess);
    await currentConnect;
    browser.resolveAccess(0, staleAccess);
    await staleConnect;

    expect(control.getSnapshot().status).toBe("connected");
    expect(control.getSnapshot().devices.map((device) => device.id)).toEqual([
      "current-input",
    ]);
    expect(staleAccess.messageListenerCount).toBe(0);
    expect(staleAccess.stateListenerCount).toBe(0);
    expect(currentAccess.messageListenerCount).toBe(1);
    expect(currentAccess.stateListenerCount).toBe(1);

    control.cleanup();
    expect(currentAccess.messageListenerCount).toBe(0);
    expect(currentAccess.stateListenerCount).toBe(0);
  });

  test("reconciles chain actions and removes mappings for deleted Effects", async () => {
    const browser = new FakeBrowser();
    const container = createDefaultEffectConfig("fxComposite", "root", 0);
    const chain = container.chains[0];
    if (!chain) {
      throw new Error("Default FX Composite must contain a chain");
    }
    const targetId = `deck-a:effect:root:chain:${chain.id}:gain`;
    const effectChange = mock(async () => ({
      desired: {
        dryWet: 1,
        sidechainSoundId: null,
        tempo: 120,
        tree: [container],
      },
      runtime: { backend: null, ready: false, status: "inactive" as const },
    }));
    const persistence = new MemoryPersistence({
      state: {
        activePresetId: "custom",
        enabled: true,
        mappings: [{ channel: 0, control: 22, targetId, type: "cc" }],
      },
      version: 2,
    });
    const control = createMidiControl({
      browser,
      effects: { change: effectChange },
      persistence,
      staticActions: [],
    });
    const binding = control.bindDeckEffects("deck-a");
    binding.reconcile([container]);

    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 22, 127]);
    browser.flushFrame();
    await Promise.resolve();

    expect(effectChange).toHaveBeenCalledWith(
      { channelId: "deck-a", sessionId: "dj" },
      {
        chainId: chain.id,
        effectId: "root",
        patch: { gain: 4 },
        type: "update-chain",
      }
    );

    binding.reconcile([]);
    expect(control.getSnapshot().mappings).toEqual([]);
    expect(persistence.value?.state.activePresetId).toBe("custom");
    expect(
      control
        .getSnapshot()
        .actions.some((action) => action.targetId === targetId)
    ).toBe(false);
  });

  test("cancels queued Effect dispatch when reconciliation removes its mapping", async () => {
    const browser = new FakeBrowser();
    const container = createDefaultEffectConfig("fxComposite", "root", 0);
    const chain = container.chains[0];
    if (!chain) {
      throw new Error("Default FX Composite must contain a chain");
    }
    const targetId = `deck-a:effect:root:chain:${chain.id}:gain`;
    const effectChange = mock(() => Promise.reject(new Error("unexpected")));
    const control = createMidiControl({
      browser,
      effects: { change: effectChange },
      persistence: new MemoryPersistence({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [{ channel: 0, control: 22, targetId, type: "cc" }],
        },
        version: 2,
      }),
      staticActions: [],
    });
    const binding = control.bindDeckEffects("deck-a");
    binding.reconcile([container]);
    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 22, 127]);

    binding.reconcile([]);

    expect(browser.hasPendingFrame).toBe(false);
    browser.flushFrame();
    expect(effectChange).not.toHaveBeenCalled();
  });

  test("applies preset, removal, learn cancellation, and clear as mapping transactions", () => {
    const persistence = new MemoryPersistence();
    const control = createMidiControl({
      browser: unsupportedBrowser,
      persistence,
      staticActions: [],
    });

    control.change({ type: "load-preset", presetId: "generic-2-deck" });
    expect(control.getSnapshot().activePresetId).toBe("generic-2-deck");
    expect(control.getSnapshot().mappings.length).toBeGreaterThan(0);

    control.change({ type: "remove-mapping", targetId: "deck-a:volume" });
    expect(control.getSnapshot().mappingsByTarget.has("deck-a:volume")).toBe(
      false
    );
    expect(control.getSnapshot().activePresetId).toBeNull();

    control.change({ type: "start-learn", targetId: "deck-a:volume" });
    control.change({ type: "stop-learn" });
    expect(control.getSnapshot().learningTarget).toBeNull();

    control.change({ type: "clear-mappings" });
    expect(control.getSnapshot().mappings).toEqual([]);
    expect(persistence.value?.state.mappings).toEqual([]);
  });

  test("migrates version-one action IDs before exposing mappings", () => {
    const persistence = new MemoryPersistence({
      state: {
        activePresetId: null,
        enabled: true,
        mappings: [
          { actionId: "deck-a:play", channel: 0, control: 1, type: "note" },
          { actionId: "deck-a:pause", channel: 0, control: 2, type: "note" },
          { actionId: "master-volume", channel: 0, control: 3, type: "cc" },
        ],
      },
      version: 1,
    } as unknown as PersistedMidiControl);

    const control = createMidiControl({
      browser: unsupportedBrowser,
      persistence,
      staticActions: [],
    });

    expect(control.getSnapshot().mappings).toEqual([
      {
        channel: 0,
        control: 1,
        targetId: "deck-a:play-pause",
        type: "note",
      },
      {
        channel: 0,
        control: 3,
        targetId: "mixer:master-volume",
        type: "cc",
      },
    ]);
    expect(persistence.value?.version).toBe(2);
  });

  test("starts without mappings when version-one storage has a malformed mapping list", () => {
    const control = createMidiControl({
      browser: unsupportedBrowser,
      persistence: new MemoryPersistence({
        state: { activePresetId: null, enabled: true, mappings: {} },
        version: 1,
      } as unknown as PersistedMidiControl),
      staticActions: [],
    });

    expect(control.getSnapshot().mappings).toEqual([]);
  });

  test("owns permission observation for its application lifetime", () => {
    const browser = new FakeBrowser();
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence(),
      staticActions: [],
    });

    control.start();
    browser.setPermission("granted");
    expect(control.getSnapshot().status).toBe("granted");

    control.cleanup();
    browser.setPermission("denied");
    expect(control.getSnapshot().status).toBe("prompt");
  });

  test("coalesces continuous controls to the existing thirty-fps policy", async () => {
    const browser = new FakeBrowser();
    const values: number[] = [];
    const control = createMidiControl({
      browser,
      persistence: new MemoryPersistence({
        state: { activePresetId: null, enabled: true, mappings: [mapping] },
        version: 2,
      }),
      staticActions: [
        {
          dispatch: (value) => values.push(value),
          group: "deck-a",
          label: "Volume",
          targetId: mapping.targetId,
          type: "continuous",
        },
      ],
    });

    control.activateDj();
    await control.connect();
    browser.emit([0xb0, 7, 32]);
    browser.flushFrame();
    browser.time = 110;
    browser.emit([0xb0, 7, 64]);
    browser.flushFrame();
    expect(values).toEqual([32 / 127]);

    browser.time = 134;
    browser.flushFrame();
    expect(values).toEqual([32 / 127, 64 / 127]);
  });
});
