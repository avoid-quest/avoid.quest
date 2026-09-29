import { describe, expect, test } from "bun:test";
import {
  cleanMetadataText,
  isPlaceholderMetadataValue,
  parseRadioTitle,
  parseRadioTitleParts,
} from "./title-parser";

describe("parseRadioTitle", () => {
  test("splits artist and title once", () => {
    expect(parseRadioTitle("Artist - Title - Mix")).toEqual({
      artist: "Artist",
      rawTitle: "Artist - Title - Mix",
      title: "Title - Mix",
    });
  });

  test("keeps show-style strings as title", () => {
    expect(parseRadioTitle("Live from Satriale with JONATHAN")).toEqual({
      artist: null,
      rawTitle: "Live from Satriale with JONATHAN",
      title: "Live from Satriale with JONATHAN",
    });
  });

  test("decodes HTML entities in metadata titles", () => {
    expect(
      parseRadioTitle("Un:seen w/ Abibi, Francis FF &amp; DJ ZBB")
    ).toEqual({
      artist: null,
      rawTitle: "Un:seen w/ Abibi, Francis FF & DJ ZBB",
      title: "Un:seen w/ Abibi, Francis FF & DJ ZBB",
    });
    expect(parseRadioTitle("Artist &lt;3 - Title &#38; Mix")).toEqual({
      artist: "Artist <3",
      rawTitle: "Artist <3 - Title & Mix",
      title: "Title & Mix",
    });
  });

  test("treats empty placeholder titles as empty", () => {
    for (const value of ["", "-", " - ", "Unknown", "\0 \0"]) {
      expect(parseRadioTitle(value)).toEqual({
        artist: null,
        rawTitle: null,
        title: null,
      });
    }
  });
});

describe("isPlaceholderMetadataValue", () => {
  test("rejects known placeholders and generated slugs", () => {
    for (const value of [
      "",
      "  ",
      "various",
      "Various",
      "misc",
      "other",
      "unknown",
      "n/a",
      "none",
      "null",
      "undefined",
      "radio",
      "LibreTime!",
      "78cxy6wkxtzuv",
    ]) {
      expect(isPlaceholderMetadataValue(value)).toBeTrue();
    }
  });

  test("keeps real values", () => {
    for (const value of [
      "Rock",
      "Radio Alhara",
      "LYL Radio",
      "abcdefghijkl",
      "1234567890",
      "Abc123def45",
      "abc123",
      "The Art of Listening",
    ]) {
      expect(isPlaceholderMetadataValue(value)).toBeFalse();
    }
  });
});

describe("parseRadioTitle junk handling", () => {
  test.each([
    ["Artist - ", { artist: null, rawTitle: "Artist", title: "Artist" }],
    [" - Title", { artist: null, rawTitle: "Title", title: "Title" }],
    ["Unknown - Unknown", { artist: null, rawTitle: null, title: null }],
    ["Now playing: A - B", { artist: "A", rawTitle: "A - B", title: "B" }],
    [
      "On Air: Morning Show",
      {
        artist: null,
        rawTitle: "Morning Show",
        title: "Morning Show",
      },
    ],
    ['"A - B"', { artist: "A", rawTitle: "A - B", title: "B" }],
    ["A – B", { artist: "A", rawTitle: "A – B", title: "B" }],
    ["A — B", { artist: "A", rawTitle: "A — B", title: "B" }],
    [
      "Jay-Z - Encore",
      { artist: "Jay-Z", rawTitle: "Jay-Z - Encore", title: "Encore" },
    ],
    [
      "radio - Rotation",
      {
        artist: null,
        rawTitle: "radio - Rotation",
        title: "Rotation",
      },
    ],
    [
      "DJ Green Giant - dj green giant",
      {
        artist: null,
        rawTitle: "DJ Green Giant - dj green giant",
        title: "dj green giant",
      },
    ],
  ])("parses %p", (value, expected) => {
    expect(parseRadioTitle(value)).toEqual(expected);
  });

  test("uses the other half when the title is the station name", () => {
    expect(
      parseRadioTitle("x.y FM #12 - Resonance EXTRA", {
        stationNames: ["Resonance Extra"],
      })
    ).toEqual({
      artist: null,
      rawTitle: "x.y FM #12 - Resonance EXTRA",
      title: "x.y FM #12",
    });
    expect(
      parseRadioTitle(
        "Naviar Broadcast #420 - Delicate Light - Resonance EXTRA",
        {
          stationNames: [null, "Resonance Extra"],
        }
      )
    ).toMatchObject({
      artist: "Naviar Broadcast #420",
      title: "Delicate Light",
    });
    expect(
      parseRadioTitle("Resonance Extra", { stationNames: ["Resonance Extra"] })
    ).toMatchObject({ title: "Resonance Extra" });
  });
});

describe("placeholder scope", () => {
  test("drops a placeholder artist but keeps a song called Radio", () => {
    expect(parseRadioTitle("radio - Rotation")).toMatchObject({
      artist: null,
      title: "Rotation",
    });
    expect(parseRadioTitle("Rammstein - Radio")).toMatchObject({
      artist: "Rammstein",
      title: "Radio",
    });
  });

  test("treats Icecast mount paths as placeholders", () => {
    expect(isPlaceholderMetadataValue("/blackout.mp3")).toBeTrue();
    expect(isPlaceholderMetadataValue("/live")).toBeTrue();
    expect(isPlaceholderMetadataValue("AC/DC")).toBeFalse();
  });
});

describe("parseRadioTitleParts", () => {
  test("keeps structured halves without re-splitting them", () => {
    expect(
      parseRadioTitleParts({
        artist: "Simon &amp; Garfunkel - Live",
        title: "The Boxer",
      })
    ).toEqual({
      artist: "Simon & Garfunkel - Live",
      rawTitle: "Simon & Garfunkel - Live - The Boxer",
      title: "The Boxer",
    });
  });

  test("drops an artist equal to the title and placeholder halves", () => {
    expect(
      parseRadioTitleParts({
        artist: "DJ Green Giant",
        title: "dj green giant",
      })
    ).toEqual({
      artist: null,
      rawTitle: "dj green giant",
      title: "dj green giant",
    });
    expect(parseRadioTitleParts({ artist: "Host", title: "unknown" })).toEqual({
      artist: null,
      rawTitle: "Host",
      title: "Host",
    });
    expect(parseRadioTitleParts({ artist: null, title: " " })).toEqual({
      artist: null,
      rawTitle: null,
      title: null,
    });
  });
});

describe("HTML entity decoding", () => {
  test("decodes named Latin-1 entities", () => {
    expect(
      cleanMetadataText("Caf&eacute; &Eacute;t&eacute; &copy; &yuml;&euro;")
    ).toBe("Café Été © ÿ€");
  });

  test("decodes exactly once", () => {
    expect(cleanMetadataText("Tom &amp;amp; Jerry")).toBe("Tom &amp; Jerry");
    expect(parseRadioTitle("Tom &amp;amp; Jerry - Hour").artist).toBe(
      "Tom &amp; Jerry"
    );
  });

  test("leaves unknown and prototype-named entities encoded", () => {
    expect(cleanMetadataText("&bogus; &constructor; &toString;")).toBe(
      "&bogus; &constructor; &toString;"
    );
  });
});
