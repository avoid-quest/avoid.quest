import { describe, expect, test } from "bun:test";
import { PLATFORM_ITEMS } from "@/lib/dj-library-sources";
import { toDjBrowserRadio } from "./browser-model";

describe("DJ browser model", () => {
  test("keeps every existing source available in Other sources", () => {
    expect(PLATFORM_ITEMS.map(({ name }) => name)).toEqual([
      "Search all",
      "Radio Garden",
      "Bandcamp",
      "SoundCloud",
      "Mixcloud",
      "YouTube",
      "Audio file",
      "Audio input",
      "Browser tab audio",
      "Radio episodes / shows",
    ]);
  });

  test("keeps the tab-sharing tiles' ids; the retired ones are not reused", () => {
    expect(
      PLATFORM_ITEMS.filter(
        ({ description }) =>
          description === "Share audio from another browser tab"
      ).map(({ id, name }) => [id, name])
    ).toEqual([
      [-11, "Browser tab audio"],
      [-14, "Radio episodes / shows"],
    ]);
    expect(PLATFORM_ITEMS.some(({ id }) => id === -12 || id === -13)).toBe(
      false
    );
  });

  test("uses the unified result location in station rows", () => {
    expect(
      toDjBrowserRadio({
        action: {
          radio: {
            description: "experimental",
            name: "Fango Radio",
            streamUrl: "https://radio.example/live",
          },
          type: "radio-browser",
        },
        country: "Italy",
        description: "experimental",
        key: "radio-browser:fango",
        name: "Fango Radio",
        sources: ["radio-browser"],
      }).description
    ).toBe("Italy");
  });
});
