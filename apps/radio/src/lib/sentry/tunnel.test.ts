import { describe, expect, mock, test } from "bun:test";
import {
  getProjectIdFromDsn,
  isAllowedEnvelopeDsn,
  readEnvelopeHeader,
  resolveTunnelTarget,
} from "./tunnel";
import { handleSentryTunnelRequest } from "./tunnel-service";

const TEST_SENTRY_DSN =
  "https://examplePublicKey@o123.ingest.us.sentry.io/9876543210";
const PRODUCTION_SENTRY_DSN =
  "https://444829d47e194352a94b3739c56ca4ee@o4510834344656896.ingest.de.sentry.io/4510834349375568";

async function buildTunnelModule(config: {
  configuredDsn?: string;
  production: boolean;
}): Promise<typeof import("./tunnel")> {
  // Inline build-time values without loading the app or initializing Sentry.
  const build = await Bun.build({
    define: {
      "import.meta.env.PROD": JSON.stringify(config.production),
      "import.meta.env.VITE_RADIO_SENTRY_DSN":
        config.configuredDsn === undefined
          ? "undefined"
          : JSON.stringify(config.configuredDsn),
    },
    entrypoints: [`${import.meta.dir}/tunnel.ts`],
    target: "bun",
  });
  expect(build.success).toBe(true);
  const [output] = build.outputs;
  if (!output) {
    throw new Error("Missing built tunnel module");
  }

  return import(
    `data:text/javascript;base64,${Buffer.from(await output.text()).toString("base64")}`
  );
}

describe("readClientSentryDsn", () => {
  test.each([
    {
      configuredDsn: undefined,
      expectedDsn: PRODUCTION_SENTRY_DSN,
      name: "uses the public radio DSN in production without an override",
      production: true,
    },
    {
      configuredDsn: undefined,
      expectedDsn: "",
      name: "leaves development disabled without an override",
      production: false,
    },
    {
      configuredDsn: ` ${TEST_SENTRY_DSN} `,
      expectedDsn: TEST_SENTRY_DSN,
      name: "prefers a trimmed production override",
      production: true,
    },
    {
      configuredDsn: TEST_SENTRY_DSN,
      expectedDsn: TEST_SENTRY_DSN,
      name: "preserves explicit development opt-in",
      production: false,
    },
    {
      configuredDsn: "",
      expectedDsn: PRODUCTION_SENTRY_DSN,
      name: "uses the public radio DSN for an empty production override",
      production: true,
    },
    {
      configuredDsn: "   ",
      expectedDsn: PRODUCTION_SENTRY_DSN,
      name: "uses the public radio DSN for a blank production override",
      production: true,
    },
    {
      configuredDsn: "   ",
      expectedDsn: "",
      name: "leaves development disabled for a blank override",
      production: false,
    },
  ])("$name", async ({ configuredDsn, production, expectedDsn }) => {
    const tunnel = await buildTunnelModule({ configuredDsn, production });

    expect(tunnel.readClientSentryDsn()).toBe(expectedDsn);
  });

  test("the production default forwards matching envelopes through the existing tunnel", async () => {
    const tunnel = await buildTunnelModule({ production: true });
    const dsn = tunnel.readClientSentryDsn();
    const fetchImpl = Object.assign(
      mock((..._args: Parameters<typeof fetch>) =>
        Promise.resolve(new Response(null, { status: 202 }))
      ),
      { preconnect: () => undefined }
    );
    const request = new Request("https://radio.test/tunnel", {
      body: new TextEncoder().encode(`{"dsn":"${dsn}"}\n{"type":"event"}\n{}`),
      method: "POST",
    });

    const response = await handleSentryTunnelRequest(request, {
      fallbackDsn: dsn,
      fetchImpl,
    });

    expect(response.status).toBe(202);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://o4510834344656896.ingest.de.sentry.io/api/4510834349375568/envelope/"
    );
  });
});

describe("resolveTunnelTarget", () => {
  test("uses runtime DSN when available", () => {
    const target = resolveTunnelTarget({
      fallbackDsn: "https://fallbackPublicKey@o999.ingest.us.sentry.io/111",
      runtimeDsn: TEST_SENTRY_DSN,
    });

    expect(target).toEqual({
      host: "o123.ingest.us.sentry.io",
      projectId: "9876543210",
    });
  });

  test("falls back to configured client DSN when runtime DSN is missing", () => {
    const target = resolveTunnelTarget({
      fallbackDsn: TEST_SENTRY_DSN,
      runtimeDsn: undefined,
    });

    expect(target).not.toBeNull();
    expect(target?.host).toBe("o123.ingest.us.sentry.io");
    expect(target?.projectId).toBe("9876543210");
  });

  test("returns null when no valid DSN is provided", () => {
    const target = resolveTunnelTarget({
      fallbackDsn: "also-not-a-url",
      runtimeDsn: "not-a-url",
    });

    expect(target).toBeNull();
  });

  test("returns null when runtime DSN is invalid even if fallback exists", () => {
    const target = resolveTunnelTarget({
      fallbackDsn: TEST_SENTRY_DSN,
      runtimeDsn: "not-a-url",
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
    host: "o123.ingest.us.sentry.io",
    projectId: "9876543210",
  };

  test("accepts matching host and project", () => {
    expect(
      isAllowedEnvelopeDsn(
        "https://abc@o123.ingest.us.sentry.io/9876543210",
        target
      )
    ).toBe(true);
  });

  test("rejects mismatched host", () => {
    expect(
      isAllowedEnvelopeDsn(
        "https://abc@o999.ingest.us.sentry.io/9876543210",
        target
      )
    ).toBe(false);
  });

  test("rejects mismatched project", () => {
    expect(
      isAllowedEnvelopeDsn("https://abc@o123.ingest.us.sentry.io/111", target)
    ).toBe(false);
  });
});

describe("getProjectIdFromDsn", () => {
  test("extracts the project id", () => {
    const dsn = new URL("https://abc@o123.ingest.us.sentry.io/42");
    expect(getProjectIdFromDsn(dsn)).toBe("42");
  });

  test("returns null for missing project id", () => {
    const dsn = new URL("https://abc@o123.ingest.us.sentry.io/");
    expect(getProjectIdFromDsn(dsn)).toBeNull();
  });
});

describe("handleSentryTunnelRequest", () => {
  test("forwards an allowed envelope through the tunnel service", async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      await Promise.resolve();
      expect(String(url)).toBe(
        "https://o123.ingest.us.sentry.io/api/9876543210/envelope/"
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/x-sentry-envelope",
      });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const envelope = new TextEncoder().encode(
      `{"dsn":"${TEST_SENTRY_DSN}"}\n{"type":"event"}\n{}`
    );
    const request = new Request("https://radio.test/tunnel", {
      body: envelope,
      method: "POST",
    });

    const response = await handleSentryTunnelRequest(request, {
      fallbackDsn: TEST_SENTRY_DSN,
      fetchImpl,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("rejects envelopes for the wrong DSN", async () => {
    const request = new Request("https://radio.test/tunnel", {
      body: new TextEncoder().encode(
        '{"dsn":"https://abc@o999.ingest.us.sentry.io/9876543210"}\n{"type":"event"}\n{}'
      ),
      method: "POST",
    });

    const response = await handleSentryTunnelRequest(request, {
      fallbackDsn: TEST_SENTRY_DSN,
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Invalid Sentry destination");
  });

  test("returns a tunnel error when forwarding fails", async () => {
    const request = new Request("https://radio.test/tunnel", {
      body: new TextEncoder().encode(
        `{"dsn":"${TEST_SENTRY_DSN}"}\n{"type":"event"}\n{}`
      ),
      method: "POST",
    });

    const response = await handleSentryTunnelRequest(request, {
      fallbackDsn: TEST_SENTRY_DSN,
      fetchImpl: (async () => {
        await Promise.resolve();
        throw new Error("network failure");
      }) as unknown as typeof fetch,
    });

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe("Error tunneling to Sentry");
  });

  test("returns unavailable when no Sentry DSN is configured", async () => {
    const request = new Request("https://radio.test/tunnel", {
      body: new TextEncoder().encode(
        `{"dsn":"${TEST_SENTRY_DSN}"}\n{"type":"event"}\n{}`
      ),
      method: "POST",
    });

    const response = await handleSentryTunnelRequest(request);

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Sentry tunnel not configured");
  });
});
