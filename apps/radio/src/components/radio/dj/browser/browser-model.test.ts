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
      "Spotify",
      "Radio episodes / shows",
    ]);
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
