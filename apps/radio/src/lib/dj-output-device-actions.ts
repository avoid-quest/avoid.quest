import type { OutputRouting } from "./output-routing.js";

type DjOutputDeviceActionOptions = {
  disableCueDecks: () => void;
  readCueOutputId: () => string | null;
  reconcileSingleRouting: () => Promise<void>;
  routing: Pick<OutputRouting, "applyMainSettings" | "applySettings">;
};

export function createDjOutputDeviceActions({
  disableCueDecks,
  readCueOutputId,
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
      const previousCueOutputId = readCueOutputId();
      await routing.applyMainSettings({
        mainOutputId: deviceId,
      });
      if (previousCueOutputId !== null && readCueOutputId() === null) {
        disableCueDecks();
      }
      await reconcileSingleRouting();
    },
  };
}
