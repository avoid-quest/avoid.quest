import { describe, expect, test } from "bun:test";
import { getDjRadios } from "./dj-radios";

describe("getDjRadios", () => {
  test("preserves persisted string radio ids for DJ mode", () => {
    const radios = [
      {
        id: "bb9f6689-4d8e-4b40-9f57-e5f47eaa89a7",
        name: "UUID Radio",
        streamUrl: "https://radio.example/stream.mp3",
      },
    ];

    expect(getDjRadios(radios)).toEqual(radios);
    expect(getDjRadios(radios)[0]?.id).toBe(
      "bb9f6689-4d8e-4b40-9f57-e5f47eaa89a7"
    );
  });

  test("defaults to an empty list without manufacturing entity ids", () => {
    expect(getDjRadios(undefined)).toEqual([]);
  });
});
