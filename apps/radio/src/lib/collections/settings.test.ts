import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getSettings,
  setPlayerMode,
  settingsCollection,
  updatePlayerSettings,
} from "./settings";

const SETTINGS_ID = "app-settings";

async function clearSettings() {
  await settingsCollection.stateWhenReady();
  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

beforeEach(clearSettings);
afterEach(clearSettings);

describe("player mode", () => {
  test("accepts node alongside the existing modes", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "node", restoreStateOnLoad: true },
    });
    expect(getSettings()?.player.mode).toBe("node");

    setPlayerMode("dj");
    expect(getSettings()?.player.mode).toBe("dj");

    updatePlayerSettings(() => ({ mode: "node" }));
    expect(getSettings()?.player.mode).toBe("node");
  });

  test("refuses multiple, which Node replaced", () => {
    setPlayerMode("node");
    expect(() =>
      settingsCollection.update(SETTINGS_ID, (draft) => {
        (draft.player as { mode: string }).mode = "multiple";
      })
    ).toThrow();
    expect(getSettings()?.player.mode).toBe("node");
  });

  test("refuses an unknown mode", () => {
    setPlayerMode("single");
    expect(() =>
      settingsCollection.update(SETTINGS_ID, (draft) => {
        (draft.player as { mode: string }).mode = "turntable";
      })
    ).toThrow();
    expect(getSettings()?.player.mode).toBe("single");
  });
});
