import { describe, expect, test } from "bun:test";
import {
  createBoundedRangeHeader,
  getContentLengthLimitFailure,
  limitResponseBody,
} from "./stream-limits";

function chunk(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("createBoundedRangeHeader", () => {
  test("preserves ranges already inside the route limit", () => {
    expect(createBoundedRangeHeader("bytes=100-199", 1024)).toEqual({
      ok: true,
      range: "bytes=100-199",
    });
  });

  test("bounds open-ended, suffix, and oversized ranges", () => {
    expect(createBoundedRangeHeader("bytes=100-", 50)).toEqual({
      ok: true,
      range: "bytes=100-149",
    });
    expect(createBoundedRangeHeader("bytes=-1000", 50)).toEqual({
      ok: true,
      range: "bytes=-50",
    });
    expect(createBoundedRangeHeader("bytes=0-9999", 50)).toEqual({
      ok: true,
      range: "bytes=0-49",
    });
  });

  test("rejects malformed and multi-range headers", () => {
    for (const range of ["items=0-10", "bytes=10-1", "bytes=0-1,3-4"]) {
      expect(createBoundedRangeHeader(range, 50)).toEqual({
        ok: false,
        reason: "invalid-range",
      });
    }
  });
});

describe("getContentLengthLimitFailure", () => {
  test("allows missing or in-limit content lengths", () => {
    expect(getContentLengthLimitFailure(new Headers(), 5)).toBeNull();
    expect(
      getContentLengthLimitFailure(new Headers({ "Content-Length": "5" }), 5)
    ).toBeNull();
  });

  test("rejects invalid or oversized content lengths", () => {
    expect(
      getContentLengthLimitFailure(
        new Headers({ "Content-Length": "not-a-number" }),
        5
      )
    ).toBe("invalid");
    expect(
      getContentLengthLimitFailure(new Headers({ "Content-Length": "6" }), 5)
    ).toBe("too-large");
  });
});

describe("limitResponseBody", () => {
  test("streams only the configured byte limit and cancels upstream", async () => {
    let wasCanceled = false;
    const abortController = new AbortController();
    const limited = limitResponseBody(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk("abc"));
          controller.enqueue(chunk("def"));
        },
        cancel() {
          wasCanceled = true;
        },
      }),
      {
        abortController,
        maxBytes: 5,
        maxDurationMs: 1000,
      }
    );

    const response = new Response(limited);

    await expect(response.text()).resolves.toBe("abcde");
    expect(wasCanceled).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe("bytes");
  });

  test("aborts streams that exceed the configured duration", async () => {
    let wasCanceled = false;
    const abortController = new AbortController();
    const limited = limitResponseBody(
      new ReadableStream<Uint8Array>({
        cancel() {
          wasCanceled = true;
        },
      }),
      {
        abortController,
        maxBytes: 100,
        maxDurationMs: 1,
      }
    );

    const response = new Response(limited);

    await expect(response.text()).resolves.toBe("");
    expect(wasCanceled).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe("duration");
  });
});
