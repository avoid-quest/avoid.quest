import { describe, expect, test } from "bun:test";
import { createDjOutputDeviceActions } from "./dj-output-device-actions";
import type {
  MainOutputRoutingSnapshot,
  OutputRouting,
  OutputRoutingSnapshot,
} from "./output-routing";

function createSnapshot(cueOutputId: string | null): OutputRoutingSnapshot {
  return {
    cueActive: cueOutputId !== null,
    deckCueEnabled: {},
    headphoneVolume: 1,
    settings: {
      cueDelayMs: 0,
      cueOutputId,
      mainDelayMs: 0,
      mainOutputId: "speakers",
    },
    sinkSelectionSupported: true,
  };
}

function createMainSnapshot(
  cueOutputId: string | null,
  cueOutputCleared = false
): MainOutputRoutingSnapshot {
  return { ...createSnapshot(cueOutputId), cueOutputCleared };
}

describe("DJ output device actions", () => {
  test("reconciles Single playback after the main output is persisted", async () => {
    let persistedMainOutput = "default";
    let finishSettings: (() => void) | undefined;
    const settingsApplied = new Promise<MainOutputRoutingSnapshot>(
      (resolve) => {
        finishSettings = () => {
          persistedMainOutput = "speakers";
          resolve(createMainSnapshot("headphones"));
        };
      }
    );
    const reconciledOutputs: string[] = [];
    const actions = createDjOutputDeviceActions({
      disableCueDecks: () => undefined,
      reconcileSingleRouting: () => {
        reconciledOutputs.push(persistedMainOutput);
        return Promise.resolve();
      },
      routing: {
        applyMainSettings: () => settingsApplied,
        applySettings: async () => createSnapshot("headphones"),
      } as Pick<OutputRouting, "applyMainSettings" | "applySettings">,
    });

    const applying = actions.applyMainOutputDevice("speakers");
    await Promise.resolve();

    expect(reconciledOutputs).toEqual([]);

    finishSettings?.();
    await applying;

    expect(reconciledOutputs).toEqual(["speakers"]);
  });

  test("keeps deck CUE when a main change preserves the configured device", async () => {
    let cueEnabled = true;
    const actions = createDjOutputDeviceActions({
      disableCueDecks: () => {
        cueEnabled = false;
      },
      reconcileSingleRouting: async () => undefined,
      routing: {
        applyMainSettings: async () => createMainSnapshot(null),
        applySettings: async () => createSnapshot("headphones"),
      } as Pick<OutputRouting, "applyMainSettings" | "applySettings">,
    });

    await actions.applyMainOutputDevice("speakers");

    expect(cueEnabled).toBe(true);
  });

  test("disables deck CUE when a main collision clears the configured device", async () => {
    let cueEnabled = true;
    const actions = createDjOutputDeviceActions({
      disableCueDecks: () => {
        cueEnabled = false;
      },
      reconcileSingleRouting: async () => undefined,
      routing: {
        applyMainSettings: async () => createMainSnapshot(null, true),
        applySettings: async () => createSnapshot(null),
      } as Pick<OutputRouting, "applyMainSettings" | "applySettings">,
    });

    await actions.applyMainOutputDevice("headphones");

    expect(cueEnabled).toBe(false);
  });

  test("disables deck CUE when the CUE output is cleared", async () => {
    let cueEnabled = true;
    const actions = createDjOutputDeviceActions({
      disableCueDecks: () => {
        cueEnabled = false;
      },
      reconcileSingleRouting: async () => undefined,
      routing: {
        applyMainSettings: async () => createMainSnapshot(null),
        applySettings: async () => createSnapshot(null),
      } as Pick<OutputRouting, "applyMainSettings" | "applySettings">,
    });

    await actions.applyCueOutputDevice(null);

    expect(cueEnabled).toBe(false);
  });
});
