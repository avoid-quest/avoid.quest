import { describe, expect, test } from "bun:test";
import { parseRadioTitle } from "./title-parser";

describe("parseRadioTitle", () => {
  test("splits artist and title once", () => {
    expect(parseRadioTitle("Artist - Title - Mix")).toEqual({
      artist: "Artist",
      title: "Title - Mix",
      rawTitle: "Artist - Title - Mix",
    });
  });

  test("keeps show-style strings as title", () => {
    expect(parseRadioTitle("Live from Satriale with JONATHAN")).toEqual({
      artist: null,
      title: "Live from Satriale with JONATHAN",
      rawTitle: "Live from Satriale with JONATHAN",
    });
  });

  test("treats empty placeholder titles as empty", () => {
    for (const value of ["", "-", " - ", "Unknown", "\0 \0"]) {
      expect(parseRadioTitle(value)).toEqual({
        artist: null,
        title: null,
        rawTitle: null,
      });
    }
  });
});
