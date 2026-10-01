import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createPlayablePlatformResolver, toPlayableSources } from "../playable";
import cryptkeeper from "./fixtures/cloudcast-cryptkeeper.json";
import notFound from "./fixtures/cloudcast-not-found.json";
import restricted from "./fixtures/cloudcast-restricted-tracklist.json";
import searchFixture from "./fixtures/search-cloudcast.json";
import { getMixcloudItem, toMixcloudItemResponse } from "./index";
import { searchMixcloud } from "./search";

const SHOW_URL = "https://www.mixcloud.com/dholbach/cryptkeeper/";
const PROGRESSIVE_URL =
  "https://dl.mixcloud.stream/secure/c/m4a/64/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a?sig=ZoVzO9AXXMDKP4gxB6y3uQ";
const HLS_URL =
  "https://aod.mixcloud.stream/secure/hls/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a/index.m3u8";

const originalFetch = globalThis.fetch;
let requests: { body: unknown; method?: string; url: string }[] = [];

function mockFetch(respond: (url: string) => Response): void {
  requests = [];
  globalThis.fetch = mock(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      requests.push({
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        method: init?.method,
        url,
      });
      return Promise.resolve(respond(url));
    }
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getMixcloudItem", () => {
  test("resolves a show to metadata and a progressive stream by default", async () => {
    mockFetch(() => Response.json(cryptkeeper));

    await expect(
      getMixcloudItem("https://m.mixcloud.com/dholbach/cryptkeeper")
    ).resolves.toEqual({
      format: "progressive",
      metadata: {
        artist: "dholbach",
        artwork:
          "https://thumbnailer.mixcloud.com/unsafe/1024x1024/extaudio/a/4/1/3/7e83-445a-4339-9f12-677a718db4de.jpg",
        duration: 3723,
        itemType: "show",
        name: "Cryptkeeper",
        platform: "mixcloud",
        streamUrl: PROGRESSIVE_URL,
        url: SHOW_URL,
      },
      streamUrl: PROGRESSIVE_URL,
      success: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      body: {
        variables: { lookup: { slug: "cryptkeeper", username: "dholbach" } },
      },
      method: "POST",
      url: "https://app.mixcloud.com/graphql",
    });
  });

  test("lets callers prefer HLS", async () => {
    mockFetch(() => Response.json(cryptkeeper));

    await expect(
      getMixcloudItem(SHOW_URL, { streamProtocols: ["hls", "progressive"] })
    ).resolves.toMatchObject({ format: "hls", streamUrl: HLS_URL });
  });

  test("rejects non-show URLs without a request", async () => {
    mockFetch(() => Response.json(cryptkeeper));

    await expect(
      getMixcloudItem("https://www.mixcloud.com/dholbach/")
    ).resolves.toEqual({
      error: "Unsupported Mixcloud URL: only show links can be played",
      success: false,
    });
    expect(requests).toHaveLength(0);
  });

  test("reports HTTP failures", async () => {
    mockFetch(() => new Response("blocked", { status: 403 }));

    await expect(getMixcloudItem(SHOW_URL)).resolves.toEqual({
      error: "Failed to get Mixcloud item: Mixcloud lookup failed: HTTP 403",
      success: false,
    });
  });
});

describe("toMixcloudItemResponse", () => {
  test("reports missing and region-restricted shows", () => {
    expect(toMixcloudItemResponse(SHOW_URL, notFound)).toEqual({
      error: "Mixcloud show not found",
      success: false,
    });
    expect(toMixcloudItemResponse(SHOW_URL, restricted)).toEqual({
      error:
        "This Mixcloud show is unavailable in this region due to licensing restrictions",
      success: false,
    });
  });

  test("reports GraphQL errors and exclusive shows", () => {
    expect(
      toMixcloudItemResponse(SHOW_URL, {
        data: { cloudcastLookup: null },
        errors: [{ message: "Bad lookup" }],
      })
    ).toEqual({ error: "Mixcloud lookup failed: Bad lookup", success: false });
    expect(
      toMixcloudItemResponse(SHOW_URL, {
        data: {
          cloudcastLookup: {
            isExclusive: true,
            name: "Select only",
            streamInfo: null,
          },
        },
      })
    ).toEqual({
      error: "This Mixcloud show is exclusive to subscribers",
      success: false,
    });
  });
});

describe("Mixcloud playable resolution", () => {
  test("resolves through the shared playable resolver", async () => {
    mockFetch(() => Response.json(cryptkeeper));

    const result = await createPlayablePlatformResolver().resolveItem(
      "https://mixcloud.com/dholbach/cryptkeeper"
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.item).toMatchObject({
      normalizedUrl: SHOW_URL,
      platform: "mixcloud",
      streamUrl: PROGRESSIVE_URL,
    });
    expect(toPlayableSources(result.item)).toEqual([
      {
        artist: "dholbach",
        duration: 3723,
        isLiveStream: false,
        platform: "mixcloud",
        streamUrl: PROGRESSIVE_URL,
        thumbnail:
          "https://thumbnailer.mixcloud.com/unsafe/1024x1024/extaudio/a/4/1/3/7e83-445a-4339-9f12-677a718db4de.jpg",
        title: "Cryptkeeper",
        url: SHOW_URL,
      },
    ]);
  });
});

describe("searchMixcloud", () => {
  test("maps recorded API results to show search results", async () => {
    mockFetch(() => Response.json(searchFixture));

    const results = await searchMixcloud("gilles peterson", 2);
    expect(requests[0]?.url).toBe(
      "https://api.mixcloud.com/search/?q=gilles+peterson&type=cloudcast&limit=2"
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "CrackMagazine/brit-funk-mixed-by-gilles-peterson",
      title: "Brit Funk – Mixed by Gilles Peterson",
      url: "https://www.mixcloud.com/CrackMagazine/brit-funk-mixed-by-gilles-peterson/",
    });
    expect(results[0]?.duration).toBeNumber();
    expect(results[0]?.thumbnail).toStartWith(
      "https://thumbnailer.mixcloud.com/"
    );
  });
});
