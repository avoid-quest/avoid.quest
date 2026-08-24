import { describe, expect, mock, test } from "bun:test";
import type { AudioManager, FilterConfig } from "@/lib/audio";
import { applyStoredFilter } from "./dj-actions-channel-strip";

describe("DJ Channel filter restoration", () => {
  test("restores the stored native filter without replaying Effects", async () => {
    const filter: FilterConfig = {
      enabled: true,
      type: "highpass",
      frequency: 400,
      Q: 1,
      gain: 0,
    };
    const audioManager = {
      updateFilter: mock(() => undefined),
    } as unknown as AudioManager;

    await applyStoredFilter(audioManager, "sound-a", filter);

    expect(audioManager.updateFilter).toHaveBeenCalledWith("sound-a", filter);
  });
});
