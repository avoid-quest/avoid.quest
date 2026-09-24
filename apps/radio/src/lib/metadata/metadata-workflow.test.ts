import { describe, expect, test } from "bun:test";
import { clearRadioMetadataCache } from "./cache";
import { createMetadataCacheFixture } from "./cache-test-fixture";
import { createRadioMetadataWorkflow } from "./metadata-workflow";
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
    const { cache, put } = createMetadataCacheFixture();
    let time = 1000;
    const urls: string[] = [];
    const request = createRequest(["https://metadata.example/live-info"]);
    const read = (requestId: string, target = request, clearLocal = true) => {
      if (clearLocal) {
        clearRadioMetadataCache();
      }
      const workflow = createRadioMetadataWorkflow({
        cache,
        fetchImpl: (url) => {
          urls.push(url);
          return Promise.resolve(
            Response.json({ current: { name: `Track ${urls.length}` } })
          );
        },
        now: () => time,
      });
      return workflow.handle({
        origin: `https://${requestId}.example`,
        request: target,
        requestId,
      });
    };
    const first = (await (await read("first")).json()) as RadioMetadataResponse;
    expect(first).toMatchObject({ refreshAfterMs: 900_000 });
    time = 30_000;
    const warm = await read("second");
    const warmPayload = (await warm.json()) as RadioMetadataResponse;
    expect(warmPayload).toMatchObject({
      data: first.ok ? first.data : null,
      refreshAfterMs: 871_000,
    });
    expect(warm.headers.get("x-request-id")).toBe("second");
    expect(warm.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://second.example"
    );
    expect(first).toMatchObject({
      data: { expiresAt: 901_000, sampledAt: 1000 },
    });
    expect(urls).toHaveLength(1);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 900 });

    // Cold Worker contexts in one data center reuse the 15-minute snapshot.
    for (const timestamp of [61_000, 300_000, 900_999]) {
      time = timestamp;
      // biome-ignore lint/performance/noAwaitInLoops: Advance the fake clock between independent requests.
      const cached = await (await read("cached")).json();
      expect(cached as RadioMetadataResponse).toMatchObject({
        data: first.ok ? first.data : null,
        refreshAfterMs: 901_000 - timestamp,
      });
    }
    expect(urls).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);

    const differentConfig = createRequest(["https://other.example/live-info"]);
    expect(
      await (await read("third", differentConfig, false)).json()
    ).toMatchObject({
      data: { title: "Track 2" },
    });
    time = 901_000;
    expect(await (await read("fourth", request, false)).json()).toMatchObject({
      data: {
        expiresAt: 1_801_000,
        sampledAt: 901_000,
        title: "Track 3",
      },
    });
    clearRadioMetadataCache();
  });

  test("does not store an upstream failure as a shared unsupported result", async () => {
    const { cache, put } = createMetadataCacheFixture();
    clearRadioMetadataCache();
    const workflow = createRadioMetadataWorkflow({
      cache,
      fetchImpl: () => Promise.resolve(new Response(null, { status: 503 })),
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

test("station-ID lookup reuses configured retrieval and cache without accepting caller overrides", async () => {
  clearRadioMetadataCache();
  const urls: string[] = [];
  const workflow = createRadioMetadataWorkflow({
    fetchImpl: (url) => {
      urls.push(url);
      return Promise.resolve(
        Response.json({ current: { name: "Shared programme" } })
      );
    },
    now: () => 1000,
  });
  const read = (query: string) =>
    workflow.handle({
      origin: "https://radio.avoid.quest",
      request: new Request(
        `https://radio.avoid.quest/api/radio-metadata?${query}`
      ),
      requestId: "station",
    });
  const byId = await read(
    "stationId=avoid-radio-sygma-radio&url=http://127.0.0.1/private&kind=icy"
  );
  expect(byId.status).toBe(200);
  const payload = (await byId.json()) as RadioMetadataResponse;
  expect(payload).toMatchObject({
    data: {
      expiresAt: 901_000,
      sampledAt: 1000,
      streamUrl: "https://radio.syg.ma/audio.mp3",
      title: "Shared programme",
    },
    ok: true,
  });
  const configured = await read(
    new URLSearchParams({
      kind: "airtime-live-info",
      metadataUrl: "https://radio.syg.ma/stats-icecast.json",
      url: "https://radio.syg.ma/audio.mp3",
    }).toString()
  );
  expect((await configured.json()) as RadioMetadataResponse).toEqual(payload);
  expect(urls).toEqual(["https://radio.syg.ma/stats-icecast.json"]);
  expect(
    (await read("stationId=not-exported&url=https://example.com/live&kind=icy"))
      .status
  ).toBe(404);
  expect((await read("stationId=")).status).toBe(404);
  expect(urls).toHaveLength(1);
  clearRadioMetadataCache();
});
