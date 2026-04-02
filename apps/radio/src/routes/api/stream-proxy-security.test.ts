import { describe, expect, it, vi } from "vitest";
import {
  fetchWithValidatedRedirects,
  isAllowedByDomainPolicy,
  isBlockedHostname,
} from "./stream-proxy-security";

describe("stream-proxy security policy", () => {
  it("denies host when allowlist is configured and host is outside policy", () => {
    expect(isAllowedByDomainPolicy("evil.example", ["trusted.example"])).toBe(false);
    expect(isAllowedByDomainPolicy("cdn.trusted.example", ["trusted.example"])).toBe(
      true
    );
  });

  it("blocks redirect to private network host", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          Location: "http://127.0.0.1/private-stream",
        },
      })
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await expect(
        fetchWithValidatedRedirects(
          "https://radio.example/stream",
          {},
          new AbortController().signal,
          []
        )
      ).rejects.toMatchObject({ code: "STREAM_PROXY_REDIRECT_BLOCKED" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks less-common local IPv4 representations", () => {
    expect(isBlockedHostname("0x7f.0x00.0x00.0x01")).toBe(true);
    expect(isBlockedHostname("2130706433")).toBe(true);
  });
});
