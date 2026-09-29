import { describe, expect, test } from "bun:test";
import {
  decodeIcyHeader,
  decodeIcyText,
  normalizeIcyMetadata,
  parseIcyMetadataBlock,
  parseIcyMetaInt,
} from "./icy-parser";

function block(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("ICY metadata parsing", () => {
  test("parses StreamTitle and StreamUrl", () => {
    const parsed = parseIcyMetadataBlock(
      block(
        "StreamTitle='Artist - Title';StreamUrl='https://example.com/art.jpg';"
      )
    );
    const normalized = normalizeIcyMetadata(parsed);

    expect(normalized?.artist).toBe("Artist");
    expect(normalized?.title).toBe("Title");
    expect(normalized?.rawTitle).toBe("Artist - Title");
    expect(normalized?.artworkUrl).toBe("https://example.com/art.jpg");
  });

  test("handles empty and padded metadata blocks", () => {
    const empty = parseIcyMetadataBlock(block(""));
    expect(empty).toEqual({ fields: {}, streamTitle: null, streamUrl: null });
    expect(normalizeIcyMetadata(empty)).toBeNull();
    expect(
      normalizeIcyMetadata(
        parseIcyMetadataBlock(block("StreamTitle=' - ';\0\0"))
      )
    ).toBeNull();
  });

  test("rejects invalid metaint values", () => {
    expect(parseIcyMetaInt("0")).toBeNull();
    expect(parseIcyMetaInt("-1")).toBeNull();
    expect(parseIcyMetaInt("1048577")).toBeNull();
    expect(parseIcyMetaInt("16000")).toBe(16_000);
  });

  test("keeps custom fields internal", () => {
    const parsed = parseIcyMetadataBlock(
      block("StreamTitle='Artist - Title';CustomField='debug';")
    );
    expect(parsed.fields.CustomField).toBe("debug");
    expect(normalizeIcyMetadata(parsed)?.fields.CustomField).toBe("debug");
  });

  test("parses StreamTitle values containing apostrophes", () => {
    const parsed = parseIcyMetadataBlock(
      block(
        "StreamTitle='Mobile Radio - Walter Marchetti's Music - Resonance EXTRA';"
      )
    );
    expect(normalizeIcyMetadata(parsed)?.rawTitle).toBe(
      "Mobile Radio - Walter Marchetti's Music - Resonance EXTRA"
    );
  });

  test("decodes Latin-1 titles that are not valid UTF-8", () => {
    // Bytes as sent by icecast.lyl.live: 0xE9 is "é" in Latin-1.
    const latin1 = Uint8Array.from(
      "StreamTitle='Clich\u00e9 Toup\u00e9e - Summer's Last Sound';",
      (char) => char.charCodeAt(0)
    );
    expect(normalizeIcyMetadata(parseIcyMetadataBlock(latin1))?.rawTitle).toBe(
      "Cliché Toupée - Summer's Last Sound"
    );
  });

  test("keeps UTF-8 titles as UTF-8", () => {
    const parsed = parseIcyMetadataBlock(
      block("StreamTitle='Café Oto - Björk – “Jóga”';")
    );
    expect(normalizeIcyMetadata(parsed)?.rawTitle).toBe(
      "Café Oto - Björk – “Jóga”"
    );
  });

  test("decodes Windows-1252 punctuation", () => {
    // 0x92 is a right single quote and 0x96 an en dash in Windows-1252.
    const parsed = parseIcyMetadataBlock(
      Uint8Array.from([
        ...block("StreamTitle='Rock"),
        0x92,
        ...block("n Roll "),
        0x96,
        ...block(" Live';"),
      ])
    );
    expect(parsed.streamTitle).toBe("Rock’n Roll – Live");
  });

  test("re-reads UTF-8 ICY headers that fetch exposed as Latin-1", () => {
    // Headers.get() maps each byte to one char, so UTF-8 "é" arrives as "Ã©".
    const asByteString = String.fromCharCode(...block("Radio Café"));
    expect(decodeIcyHeader(asByteString)).toBe("Radio Café");
    expect(decodeIcyHeader("Radio Caf\u00e9")).toBe("Radio Café");
    expect(decodeIcyHeader("Plain ASCII")).toBe("Plain ASCII");
    expect(decodeIcyHeader(null)).toBeNull();
  });

  test("decodes HTML entities in StreamTitle exactly once", () => {
    const parsed = parseIcyMetadataBlock(
      block("StreamTitle='Tom &amp;amp; Jerry - Caf&eacute;';")
    );
    expect(normalizeIcyMetadata(parsed)).toMatchObject({
      artist: "Tom &amp; Jerry",
      rawTitle: "Tom &amp; Jerry - Café",
      title: "Café",
    });
  });

  test("accepts StreamUrl as artwork only when it points at an image", () => {
    const artworkFor = (streamUrl: string) =>
      normalizeIcyMetadata(
        parseIcyMetadataBlock(
          block(`StreamTitle='Artist - Title';StreamUrl='${streamUrl}';`)
        )
      )?.artworkUrl;

    expect(artworkFor("https://station.example/")).toBeNull();
    expect(artworkFor("https://station.example/shows/today")).toBeNull();
    expect(artworkFor("https://station.example/cover.html")).toBeNull();
    expect(artworkFor("https://cdn.example/art.JPG?size=large")).toBe(
      "https://cdn.example/art.JPG?size=large"
    );
    for (const extension of ["jpeg", "png", "webp", "gif", "avif"]) {
      expect(artworkFor(`https://cdn.example/art.${extension}`)).toBe(
        `https://cdn.example/art.${extension}`
      );
    }
    expect(
      normalizeIcyMetadata(
        parseIcyMetadataBlock(block("StreamUrl='https://station.example/';"))
      )
    ).toBeNull();
  });

  test("keeps a quote-semicolon inside a StreamTitle value", () => {
    const parsed = parseIcyMetadataBlock(
      block("StreamTitle='Rock';n'roll - Live';StreamUrl='';")
    );
    expect(parsed.streamTitle).toBe("Rock';n'roll - Live");
    expect(parsed.streamUrl).toBe("");
    expect(
      parseIcyMetadataBlock(block("StreamTitle='Rock';n'roll - Live';\0\0"))
        .streamTitle
    ).toBe("Rock';n'roll - Live");
  });

  test("still reads a value followed by trailing noise", () => {
    expect(
      parseIcyMetadataBlock(block("StreamTitle='Artist - Title';garbage"))
        .streamTitle
    ).toBe("Artist - Title");
  });

  test("normalizes the title against the station name", () => {
    const parsed = parseIcyMetadataBlock(
      block("StreamTitle='x.y FM #12 - Resonance EXTRA';")
    );
    expect(
      normalizeIcyMetadata(parsed, { stationNames: ["Resonance Extra"] })
    ).toMatchObject({ artist: null, title: "x.y FM #12" });
  });

  test("decodes text bytes as UTF-8 or Windows-1252", () => {
    expect(decodeIcyText(block("Björk"))).toBe("Björk");
    expect(decodeIcyText(Uint8Array.from([0x42, 0x6a, 0xf6, 0x72, 0x6b]))).toBe(
      "Björk"
    );
  });
});
