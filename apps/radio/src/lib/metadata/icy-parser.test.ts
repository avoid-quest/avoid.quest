import { describe, expect, test } from "bun:test";
import {
  decodeIcyHeader,
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
});
