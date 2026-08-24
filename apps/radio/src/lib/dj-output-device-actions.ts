import type { OutputRouting } from "./output-routing.js";

type DjOutputDeviceActionOptions = {
  disableCueDecks: () => void;
  reconcileSingleRouting: () => Promise<void>;
  routing: Pick<OutputRouting, "applyMainSettings" | "applySettings">;
};

export function createDjOutputDeviceActions({
  disableCueDecks,
  reconcileSingleRouting,
  routing,
}: DjOutputDeviceActionOptions) {
  return {
    async applyCueOutputDevice(deviceId: string | null): Promise<void> {
      const state = await routing.applySettings({ cueOutputId: deviceId });
      if (state.settings.cueOutputId === null) {
        disableCueDecks();
      }
    },
    async applyMainOutputDevice(deviceId: string): Promise<void> {
      const state = await routing.applyMainSettings({
        mainOutputId: deviceId,
      });
      if (state.cueOutputCleared) {
        disableCueDecks();
      }
      await reconcileSingleRouting();
    },
  };
}
