import { describe, expect, test } from "bun:test";
import { clearRadioMetadataCache } from "./cache";
import { createRadioMetadataWorkflow } from "./metadata-workflow";
import { createMetadataStoreFixture } from "./store-test-fixture";
import type { RadioMetadataResponse } from "./types";

function createRequest(metadataUrls: string[]): Request {
  const params = new URLSearchParams({
    kind: "airtime-live-info",
    url: "https://radio.example/live.mp3",
  });
  for (const url of metadataUrls) {
    params.append("metadataUrl", url);
  }
  return new Request(`https://app.example/api/radio-metadata?${params}`);
}

describe("createRadioMetadataWorkflow", () => {
  test("shares live snapshots between independent request contexts without resampling", async () => {
    const { store, put } = createMetadataStoreFixture();
    let time = 1000;
    const urls: string[] = [];
    const request = createRequest(["https://metadata.example/live-info"]);
    const read = (requestId: string, target = request, clearLocal = true) => {
      if (clearLocal) {
        clearRadioMetadataCache();
      }
      const workflow = createRadioMetadataWorkflow({
        fetchImpl: (url) => {
          urls.push(url);
          return Promise.resolve(
            Response.json({ current: { name: `Track ${urls.length}` } })
          );
        },
        now: () => time,
        store,
      });
      return workflow.handle({
        origin: `https://${requestId}.example`,
        request: target,
        requestId,
      });
    };
    const first = (await (await read("first")).json()) as RadioMetadataResponse;
    time = 30_000;
    const warm = await read("second");
    expect((await warm.json()) as RadioMetadataResponse).toEqual(first);
    expect(warm.headers.get("x-request-id")).toBe("second");
    expect(warm.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://second.example"
    );
    expect(first).toMatchObject({
      data: { expiresAt: 61_000, sampledAt: 1000 },
    });
    expect(urls).toHaveLength(1);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });

    const differentConfig = createRequest(["https://other.example/live-info"]);
    expect(
      await (await read("third", differentConfig, false)).json()
    ).toMatchObject({
      data: { title: "Track 2" },
    });
    time = 61_000;
    expect(await (await read("fourth", request, false)).json()).toMatchObject({
      data: {
        expiresAt: 121_000,
        sampledAt: 61_000,
        title: "Track 3",
      },
    });
    clearRadioMetadataCache();
  });

  test("does not store an upstream failure as a shared unsupported result", async () => {
    const { store, put } = createMetadataStoreFixture();
    clearRadioMetadataCache();
    const workflow = createRadioMetadataWorkflow({
      fetchImpl: () => Promise.resolve(new Response(null, { status: 503 })),
      store,
    });
    const response = await workflow.handle({
      origin: "https://app.example",
      request: createRequest(["https://metadata.example/live-info"]),
      requestId: "failed",
    });
    expect(response.status).toBe(502);
    expect(put).not.toHaveBeenCalled();
    clearRadioMetadataCache();
  });

  test("rejects excessive Airtime metadata URL fan-out", async () => {
    const workflow = createRadioMetadataWorkflow();
    const response = await workflow.handle({
      origin: "https://app.example",
      request: createRequest([
        "https://one.example/api/live-info",
        "https://two.example/api/live-info",
        "https://three.example/api/live-info",
        "https://four.example/api/live-info",
        "https://five.example/api/live-info",
        "https://six.example/api/live-info",
      ]),
      requestId: "test-request",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RADIO_METADATA_INVALID_URL" },
      ok: false,
    });
  });

  test("rejects duplicate Airtime metadata URLs", async () => {
    const workflow = createRadioMetadataWorkflow();
    const response = await workflow.handle({
      origin: "https://app.example",
      request: createRequest([
        "https://one.example/api/live-info",
        "https://one.example/api/live-info",
      ]),
      requestId: "test-request",
    });

    expect(response.status).toBe(400);
  });
});
