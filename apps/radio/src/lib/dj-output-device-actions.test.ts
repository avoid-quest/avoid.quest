import { describe, expect, test } from "bun:test";
import { createDjOutputDeviceActions } from "./dj-output-device-actions";
import type { OutputRouting, OutputRoutingSnapshot } from "./output-routing";

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

describe("DJ output device actions", () => {
  test("reconciles Single playback after the main output is persisted", async () => {
    let persistedMainOutput = "default";
    let finishSettings: (() => void) | undefined;
    const settingsApplied = new Promise<OutputRoutingSnapshot>((resolve) => {
      finishSettings = () => {
        persistedMainOutput = "speakers";
        resolve(createSnapshot("headphones"));
      };
    });
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

  test("disables deck CUE when output collision clears the persisted device", async () => {
    let cueEnabled = true;
    const actions = createDjOutputDeviceActions({
      disableCueDecks: () => {
        cueEnabled = false;
      },
      reconcileSingleRouting: async () => undefined,
      routing: {
        applyMainSettings: async () => createSnapshot(null),
        applySettings: async () => createSnapshot(null),
      } as Pick<OutputRouting, "applyMainSettings" | "applySettings">,
    });

    await actions.applyCueOutputDevice("speakers");

    expect(cueEnabled).toBe(false);
  });
});
