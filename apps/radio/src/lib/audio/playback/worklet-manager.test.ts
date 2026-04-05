import { describe, expect, test } from "bun:test";
import { WorkletManager } from "./worklet-manager";

describe("WorkletManager", () => {
  test("posts peak meter enable and disable messages", () => {
    const manager = new WorkletManager({} as AudioContext, "/processor.js");
    const messages: Array<{ type: string; payload?: unknown }> = [];

    (
      manager as unknown as {
        workletNode: {
          port: {
            postMessage: (message: { type: string; payload?: unknown }) => void;
          };
        };
      }
    ).workletNode = {
      port: {
        postMessage(message) {
          messages.push(message);
        },
      },
    };

    manager.setPeakMeterEnabled(true);
    manager.setPeakMeterEnabled(true);
    manager.setPeakMeterEnabled(false);

    expect(messages).toEqual([
      { type: "ENABLE_PEAK_METER", payload: { enabled: true } },
      { type: "ENABLE_PEAK_METER", payload: { enabled: false } },
    ]);
  });
});
