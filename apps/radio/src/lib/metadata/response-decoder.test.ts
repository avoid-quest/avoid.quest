import { describe, expect, test } from "bun:test";
import { decodeRadioMetadataResponse } from "./response-decoder";

describe("decodeRadioMetadataResponse", () => {
  test("decodes supported metadata", () => {
    const result = decodeRadioMetadataResponse(new Response(null), {
      data: { title: "Track" },
      ok: true,
    });
    expect(result.kind).toBe("metadata");
  });

  test("decodes unsupported as a non-error result", () => {
    const result = decodeRadioMetadataResponse(new Response(null), {
      error: {
        code: "RADIO_METADATA_UNSUPPORTED",
        message: "No metadata",
      },
      ok: false,
    });
    expect(result.kind).toBe("unsupported");
  });

  test("turns metadata failures into safe messages", () => {
    const result = decodeRadioMetadataResponse(new Response(null), {
      error: {
        code: "RADIO_METADATA_TIMEOUT",
        message: "Timed out",
      },
      ok: false,
    });
    expect(result).toEqual({ kind: "failure", message: "Timed out" });
  });

  test("handles problem-shaped responses", () => {
    const result = decodeRadioMetadataResponse(
      new Response(null, { status: 429 }),
      { title: "Rate limited" }
    );
    expect(result).toEqual({ kind: "failure", message: "Rate limited" });
  });

  test("handles malformed success responses", () => {
    const result = decodeRadioMetadataResponse(new Response(null), {
      ok: true,
    });
    expect(result).toEqual({
      kind: "failure",
      message: "Invalid radio metadata response",
    });
  });
});
