import { expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

/** Which storage areas throw on access, as when the browser blocks site data. */
const scenarios = {
  "all-storage-blocked": ["localStorage", "sessionStorage"],
  "local-storage-blocked": ["localStorage"],
} as const;
type Scenario = keyof typeof scenarios;
const scenario = process.env.AVOID_QUEST_BLOCKED_STORAGE_SCENARIO as
  | Scenario
  | undefined;

if (scenario) {
  const dom = new JSDOM("", { url: "https://radio.test" });
  const blocked: readonly string[] = scenarios[scenario];
  for (const area of ["localStorage", "sessionStorage"] as const) {
    const descriptor: PropertyDescriptor = blocked.includes(area)
      ? {
          configurable: true,
          get: () => {
            throw new dom.window.DOMException(
              "The operation is insecure.",
              "SecurityError"
            );
          },
        }
      : { configurable: true, value: dom.window[area] };
    Object.defineProperty(dom.window, area, descriptor);
    Object.defineProperty(globalThis, area, descriptor);
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  // Only the rendering boundary is replaced; boot, loaders and collections are real.
  mock.module("./single", () => ({ SingleRadio: () => null }));
  mock.module("./node", () => ({ NodeRadios: () => null }));
  mock.module("./dj/dj-player", () => ({ DjPlayer: () => null }));

  const windowErrors: unknown[] = [];
  dom.window.addEventListener("error", (event: ErrorEvent) => {
    windowErrors.push(event.error);
  });

  test(scenario, async () => {
    const { loadRootSyncChanges } = await import("@/lib/root/root-bootstrap");
    const settings = await import("@/lib/collections/settings");
    const radios = await import("@/lib/collections/radios");
    const sessionRadios = await import("@/lib/collections/session-radios");
    const sessions = await import("@/lib/collections/playback-sessions");
    const { resetAllSettings } = await import("@/lib/settings");
    const { getLastExportDate } = await import("@/lib/db/export-import");
    const { createLocalMidiMappingPersistence } = await import(
      "@/lib/midi/local-midi-mapping-persistence"
    );
    const { loadDjPlayer, loadNodeRadios, loadSingleRadio } = await import(
      "./radio-mode-loader"
    );

    await loadRootSyncChanges();
    expect(radios.getAllRadios().length).toBeGreaterThan(0);
    expect(settings.getSettings()?.player.mode).toBe("single");

    // Every mode prepares its sessions in memory for this visit.
    for (const [mode, load] of [
      ["node", loadNodeRadios],
      ["dj", loadDjPlayer],
      ["single", loadSingleRadio],
    ] as const) {
      settings.setPlayerMode(mode);
      // biome-ignore lint/performance/noAwaitInLoops: modes switch one after another.
      await load();
      expect(settings.getSettings()?.player.mode).toBe(mode);
      expect(sessions.getPlaybackSession(mode)).toBeDefined();
    }
    sessions.updatePlaybackSession("single", (draft) => {
      draft.masterVolume = 0.5;
    });
    expect(sessions.getPlaybackSession("single")?.masterVolume).toBe(0.5);

    // Cross-tab listeners stay quiet rather than throwing on a storage event.
    let otherTabWrites = 0;
    const stop = sessions.subscribeToOtherTabSessionWrites(() => {
      otherTabWrites += 1;
    });
    dom.window.dispatchEvent(
      new dom.window.StorageEvent("storage", {
        key: sessions.PLAYBACK_SESSIONS_STORAGE_KEY,
      })
    );
    await Promise.resolve();
    stop();
    expect(otherTabWrites).toBe(0);

    const [station] = radios.getAllRadios();
    radios.addDismissedRadio(station.name);
    expect(radios.getDismissedRadios().has(station.name)).toBe(true);
    radios.removeDismissedRadio(station.name);
    expect(radios.getDismissedRadios().has(station.name)).toBe(false);

    sessionRadios.addSessionRadio({
      id: "rb_blocked",
      name: "Found station",
      streamUrl: "https://radio.test/found.mp3",
    });
    expect(sessionRadios.getSessionRadios().map((radio) => radio.id)).toEqual([
      "rb_blocked",
    ]);

    expect(getLastExportDate()).toBeNull();
    const midi = createLocalMidiMappingPersistence();
    expect(midi.read()).toBeNull();
    midi.write({ mappings: [], version: 1 } as unknown as Parameters<
      typeof midi.write
    >[0]);

    await resetAllSettings();
    expect(settings.getSettings()?.player.mode).toBe("single");
    expect(radios.getAllRadios().length).toBeGreaterThan(0);
    expect(windowErrors).toEqual([]);
  });
} else {
  for (const pageScenario of Object.keys(scenarios)) {
    test(`boot with ${pageScenario}`, async () => {
      // Each process is a fresh page: module caches and collection storage start together.
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: {
          ...process.env,
          AVOID_QUEST_BLOCKED_STORAGE_SCENARIO: pageScenario,
        },
        stderr: "pipe",
        stdout: "pipe",
        timeout: 10_000,
      });
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
        errors: "",
        exitCode: 0,
      });
    });
  }
}
