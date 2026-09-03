import { describe, expect, mock, test } from "bun:test";
import { createValidatedHlsFetchSetup } from "./hls-request";

describe("createValidatedHlsFetchSetup", () => {
  test("preserves range requests while forcing safe fetch policy", async () => {
    const fetchSetup = createValidatedHlsFetchSetup({
      credentials: "omit",
      resolveHostname: async () => ["203.0.113.8"],
    });
    const signal = new AbortController().signal;
    const request = await fetchSetup(
      { url: "https://media.example/segment.ts" },
      {
        credentials: "include",
        headers: new Headers({ Range: "bytes=5-10" }),
        signal,
      }
    );

    expect(request.headers.get("Range")).toBe("bytes=5-10");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBe(signal);
  });

  test("rejects every HLS request whose hostname resolves privately", async () => {
    const fetchSetup = createValidatedHlsFetchSetup({
      resolveHostname: async () => ["127.0.0.1"],
    });

    await expect(
      fetchSetup(
        { url: "https://media.example/nested.m3u8" },
        { headers: new Headers() }
      )
    ).rejects.toThrow("unsafe HLS resource URL");
  });

  test("reuses one host resolution across playlist and segment requests", async () => {
    const resolveHostname = mock(async () => ["203.0.113.8"]);
    const fetchSetup = createValidatedHlsFetchSetup({ resolveHostname });

    await fetchSetup(
      { url: "https://media.example/nested.m3u8" },
      { headers: new Headers() }
    );
    await fetchSetup(
      { url: "https://media.example/segment.ts" },
      { headers: new Headers() }
    );

    expect(resolveHostname).toHaveBeenCalledTimes(1);
  });

  test("retries hostname resolution after an aborted lookup", async () => {
    const resolveHostname = mock()
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce(["203.0.113.8"]);
    const fetchSetup = createValidatedHlsFetchSetup({ resolveHostname });

    await expect(
      fetchSetup(
        { url: "https://media.example/live.m3u8" },
        { headers: new Headers() }
      )
    ).rejects.toThrow("unsafe HLS resource URL");
    await expect(
      fetchSetup(
        { url: "https://media.example/live.m3u8" },
        { headers: new Headers() }
      )
    ).resolves.toBeInstanceOf(Request);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
  });
});
