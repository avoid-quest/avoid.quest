import { describe, expect, test } from "bun:test";
import {
  CLIENT_SENTRY_DSN,
  getProjectIdFromDsn,
  isAllowedEnvelopeDsn,
  readEnvelopeHeader,
  resolveTunnelTarget,
} from "./tunnel";
import { handleSentryTunnelRequest } from "./tunnel-service";

describe("resolveTunnelTarget", () => {
  test("uses runtime DSN when available", () => {
    const target = resolveTunnelTarget({
      runtimeDsn:
        "https://examplePublicKey@o123.ingest.us.sentry.io/9876543210",
      fallbackDsn: CLIENT_SENTRY_DSN,
    });

    expect(target).toEqual({
      host: "o123.ingest.us.sentry.io",
      projectId: "9876543210",
    });
  });

  test("falls back to client DSN when runtime DSN is missing", () => {
    const target = resolveTunnelTarget({
      runtimeDsn: undefined,
      fallbackDsn: CLIENT_SENTRY_DSN,
    });

    expect(target).not.toBeNull();
    expect(target?.host).toBe("o4510834344656896.ingest.de.sentry.io");
    expect(target?.projectId).toBe("4510834349375568");
  });

  test("returns null when no valid DSN is provided", () => {
    const target = resolveTunnelTarget({
      runtimeDsn: "not-a-url",
      fallbackDsn: "also-not-a-url",
    });

    expect(target).toBeNull();
  });

  test("returns null when runtime DSN is invalid even if fallback exists", () => {
    const target = resolveTunnelTarget({
      runtimeDsn: "not-a-url",
      fallbackDsn: CLIENT_SENTRY_DSN,
    });

    expect(target).toBeNull();
  });
});

describe("readEnvelopeHeader", () => {
  test("parses a valid envelope header", () => {
    const envelope = new TextEncoder().encode(
      '{"dsn":"https://abc@o123.ingest.us.sentry.io/42"}\n{"type":"event"}\n{}'
    );
    const header = readEnvelopeHeader(envelope.buffer);

    expect(header).toEqual({
      dsn: "https://abc@o123.ingest.us.sentry.io/42",
    });
  });

  test("returns null when envelope header is malformed", () => {
    const envelope = new TextEncoder().encode('{"dsn":"broken-json"\n{}');
    const header = readEnvelopeHeader(envelope.buffer);

    expect(header).toBeNull();
  });

  test("returns null when envelope has no header line", () => {
    const envelope = new TextEncoder().encode("{}");
    const header = readEnvelopeHeader(envelope.buffer);

    expect(header).toBeNull();
  });
});

describe("isAllowedEnvelopeDsn", () => {
  const target = {
    host: "o4510834344656896.ingest.de.sentry.io",
    projectId: "4510834349375568",
  };

  test("accepts matching host and project", () => {
    expect(
      isAllowedEnvelopeDsn(
        "https://abc@o4510834344656896.ingest.de.sentry.io/4510834349375568",
        target
      )
    ).toBe(true);
  });

  test("rejects mismatched host", () => {
    expect(
      isAllowedEnvelopeDsn(
        "https://abc@o999.ingest.de.sentry.io/4510834349375568",
        target
      )
    ).toBe(false);
  });

  test("rejects mismatched project", () => {
    expect(
      isAllowedEnvelopeDsn(
        "https://abc@o4510834344656896.ingest.de.sentry.io/111",
        target
      )
    ).toBe(false);
  });
});

describe("getProjectIdFromDsn", () => {
  test("extracts the project id", () => {
    const dsn = new URL("https://abc@o4510834344656896.ingest.de.sentry.io/42");
    expect(getProjectIdFromDsn(dsn)).toBe("42");
  });

  test("returns null for missing project id", () => {
    const dsn = new URL("https://abc@o4510834344656896.ingest.de.sentry.io/");
    expect(getProjectIdFromDsn(dsn)).toBeNull();
  });
});

describe("handleSentryTunnelRequest", () => {
  test("forwards an allowed envelope through the tunnel service", async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      await Promise.resolve();
      expect(String(url)).toBe(
        "https://o4510834344656896.ingest.de.sentry.io/api/4510834349375568/envelope/"
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/x-sentry-envelope",
      });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const envelope = new TextEncoder().encode(
      `{"dsn":"${CLIENT_SENTRY_DSN}"}\n{"type":"event"}\n{}`
    );
    const request = new Request("https://radio.test/tunnel", {
      method: "POST",
      body: envelope,
    });

    const response = await handleSentryTunnelRequest(request, { fetchImpl });

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("rejects envelopes for the wrong DSN", async () => {
    const request = new Request("https://radio.test/tunnel", {
      method: "POST",
      body: new TextEncoder().encode(
        '{"dsn":"https://abc@o999.ingest.de.sentry.io/4510834349375568"}\n{"type":"event"}\n{}'
      ),
    });

    const response = await handleSentryTunnelRequest(request);

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Invalid Sentry destination");
  });

  test("returns a tunnel error when forwarding fails", async () => {
    const request = new Request("https://radio.test/tunnel", {
      method: "POST",
      body: new TextEncoder().encode(
        `{"dsn":"${CLIENT_SENTRY_DSN}"}\n{"type":"event"}\n{}`
      ),
    });

    const response = await handleSentryTunnelRequest(request, {
      fetchImpl: (async () => {
        await Promise.resolve();
        throw new Error("network failure");
      }) as unknown as typeof fetch,
    });

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe("Error tunneling to Sentry");
  });
});
