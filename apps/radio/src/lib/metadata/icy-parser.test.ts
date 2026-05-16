import { describe, expect, test } from "bun:test";
import {
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
    expect(normalizeIcyMetadata(parseIcyMetadataBlock(block("")))).toBeNull();
    expect(
      normalizeIcyMetadata(
        parseIcyMetadataBlock(block("StreamTitle=' - ';\0\0"))
      )
    ).toBeNull();
  });

  test("rejects excessive metaint values", () => {
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
});
