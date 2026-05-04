import { describe, expect, test } from "bun:test";
import type { Radio } from "../playback/index.js";
import { SoundRegistry } from "./sound-registry.js";

const radio: Radio = {
  id: "radio-1",
  name: "Test Radio",
  streamUrl: "https://example.com/stream.mp3",
};

describe("SoundRegistry", () => {
  test("owns sound lookup and replacement without Web Audio dependencies", () => {
    const registry = new SoundRegistry();

    const soundId = registry.create(radio, "deck-a");
    const first = registry.get(soundId);

    expect(soundId).toBe("deck-a");
    expect(registry.has("deck-a")).toBe(true);
    expect(first?.radio).toEqual(radio);
    expect(first?.volume).toBe(1);

    const replacementRadio = { ...radio, name: "Replacement" };
    const replaced: string[] = [];
    registry.create(replacementRadio, "deck-a", (existingSoundId) => {
      replaced.push(existingSoundId);
    });

    expect(replaced).toEqual(["deck-a"]);
    expect(registry.get("deck-a")?.radio.name).toBe("Replacement");
    expect(registry.get("deck-a")).not.toBe(first);
  });
});
