import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addSessionRadio,
  getSessionRadios,
  isSessionRadio,
  removeSessionRadio,
  sessionRadiosCollection,
} from "./use-session-radios";

function createMemoryStorage(): Storage {
  const state = new Map<string, string>();

  return {
    clear() {
      state.clear();
    },
    getItem(key) {
      return state.get(key) ?? null;
    },
    key(index) {
      return Array.from(state.keys())[index] ?? null;
    },
    get length() {
      return state.size;
    },
    removeItem(key) {
      state.delete(key);
    },
    setItem(key, value) {
      state.set(key, value);
    },
  };
}

if (typeof sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
}

async function resetSessionRadios() {
  await sessionRadiosCollection.stateWhenReady();

  for (const radioId of Array.from(sessionRadiosCollection.state.keys())) {
    sessionRadiosCollection.delete(radioId);
  }
  sessionStorage.clear();
}

beforeEach(async () => {
  await resetSessionRadios();
});

afterEach(async () => {
  await resetSessionRadios();
});

describe("session radios", () => {
  test("recognizes Radio Garden and Radio Browser temporary station IDs", () => {
    expect(
      isSessionRadio({ id: "rg_station", name: "Garden", streamUrl: "x" })
    ).toBe(true);
    expect(
      isSessionRadio({ id: "rb_station", name: "Browser", streamUrl: "x" })
    ).toBe(true);
    expect(isSessionRadio({ id: "saved", name: "Saved", streamUrl: "x" })).toBe(
      false
    );
  });

  test("stores session radios in newest-first order without duplicates and evicts old entries", async () => {
    await sessionRadiosCollection.stateWhenReady();

    for (let index = 0; index < 21; index += 1) {
      addSessionRadio({
        id: `rg_${index}`,
        name: `Session ${index}`,
        streamUrl: `https://radio.example/${index}.mp3`,
      });
    }
    addSessionRadio({
      id: "rg_20",
      name: "Session 20 duplicate",
      streamUrl: "https://radio.example/20-duplicate.mp3",
    });

    const radios = getSessionRadios();

    expect(radios).toHaveLength(20);
    expect(radios[0]?.id).toBe("rg_20");
    expect(radios[0]?.name).toBe("Session 20 duplicate");
    expect(radios[0]?.streamUrl).toBe("https://radio.example/20-duplicate.mp3");
    expect(radios.at(-1)?.id).toBe("rg_1");
    expect(radios.some((radio) => radio.id === "rg_0")).toBe(false);
  });

  test("refreshes a Radio Browser session record when its resolved stream changes", async () => {
    await sessionRadiosCollection.stateWhenReady();

    addSessionRadio({
      id: "rb_station",
      name: "Station",
      streamUrl: "https://radio.example/old.mp3",
    });
    addSessionRadio({
      id: "rb_station",
      name: "Station",
      streamUrl: "https://radio.example/new.mp3",
    });

    expect(getSessionRadios()).toEqual([
      {
        id: "rb_station",
        name: "Station",
        streamUrl: "https://radio.example/new.mp3",
      },
    ]);
  });

  test("removes a session radio from the session-backed collection", async () => {
    await sessionRadiosCollection.stateWhenReady();

    addSessionRadio({
      id: "rg_keep",
      name: "Keep",
      streamUrl: "https://radio.example/keep.mp3",
    });
    addSessionRadio({
      id: "rg_remove",
      name: "Remove",
      streamUrl: "https://radio.example/remove.mp3",
    });

    removeSessionRadio("rg_remove");

    expect(getSessionRadios().map((radio) => radio.id)).toEqual(["rg_keep"]);
  });

  test("persists session radios to the session storage collection backend", async () => {
    await sessionRadiosCollection.stateWhenReady();

    addSessionRadio({
      id: "rg_restore",
      name: "Restore",
      streamFormat: "hls",
      streamUrl: "https://radio.example/restore.mp3",
    });

    const stored = JSON.parse(
      sessionStorage.getItem("radio-session-radios") ?? "{}"
    ) as Record<string, { data?: { name?: string; streamFormat?: string } }>;

    expect(stored["s:rg_restore"].data?.name).toBe("Restore");
    expect(stored["s:rg_restore"].data?.streamFormat).toBe("hls");
  });

  test("restores legacy session radios from the previous session storage shape", async () => {
    await sessionRadiosCollection.stateWhenReady();

    sessionStorage.setItem(
      "radio-session-radios",
      JSON.stringify({
        state: {
          radios: [
            {
              id: "rg_legacy",
              name: "Legacy",
              streamUrl: "https://radio.example/legacy.mp3",
            },
          ],
        },
        version: 0,
      })
    );
    const sync = sessionRadiosCollection.config.sync as {
      manualTrigger?: () => void;
    };
    sync.manualTrigger?.();

    expect(getSessionRadios().map((radio) => radio.id)).toEqual(["rg_legacy"]);
  });

  test("adds new session radios ahead of restored records", async () => {
    await sessionRadiosCollection.stateWhenReady();

    sessionStorage.setItem(
      "radio-session-radios",
      JSON.stringify({
        "s:rg_restored": {
          data: {
            addedAt: Date.now() + 60_000,
            id: "rg_restored",
            name: "Restored",
            streamUrl: "https://radio.example/restored.mp3",
          },
          versionKey: "restored",
        },
      })
    );
    const sync = sessionRadiosCollection.config.sync as {
      manualTrigger?: () => void;
    };
    sync.manualTrigger?.();

    addSessionRadio({
      id: "rg_new",
      name: "New",
      streamUrl: "https://radio.example/new.mp3",
    });

    expect(getSessionRadios().map((radio) => radio.id)).toEqual([
      "rg_new",
      "rg_restored",
    ]);
  });
});
