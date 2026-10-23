import { expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createMetadataCacheFixture } from "./cache-test-fixture";
import { createRadioGuide } from "./guide";

const now = Date.parse("2026-10-23T12:30:00Z");
const nts = {
  results: ["1", "2"].map((channel_name) => ({
    channel_name,
    now: {
      broadcast_title: `Channel ${channel_name} show`,
      start_timestamp: "2026-10-23T12:00:00Z",
      end_timestamp: "2026-10-23T13:00:00Z",
    },
  })),
};

test("public guide tolerates partial failures, coalesces requests and caches without sessions", async () => {
  let requests = 0;
  let time = now;
  const { cache } = createMetadataCacheFixture();
  const fetchImpl = (input: string | URL | Request) => {
    requests += 1;
    return Promise.resolve(
      String(input).includes("nts.live")
        ? Response.json(nts)
        : new Response(null, { status: 503 })
    );
  };
  const dependencies = {
    cache,
    fetchImpl: fetchImpl as typeof fetch,
    now: () => time,
  };
  const guide = createRadioGuide(dependencies);
  const [firstResponse, secondResponse] = await Promise.all([
    guide.handle(),
    guide.handle(),
  ]);
  expect(firstResponse.headers.get("Content-Type")).toBe(
    "application/xml; charset=utf-8"
  );
  expect(firstResponse.headers.get("Cache-Control")).toBe(
    "public, max-age=300"
  );
  expect(firstResponse.headers.has("Set-Cookie")).toBe(false);
  const xml = await firstResponse.text();
  expect(await secondResponse.text()).toBe(xml);
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  expect(dom.window.document.querySelectorAll("channel")).toHaveLength(10);
  expect(dom.window.document.querySelectorAll("programme")).toHaveLength(2);
  const coldRequests = requests;
  expect(coldRequests).toBeLessThanOrEqual(8);
  await guide.handle();
  expect(requests).toBe(coldRequests);
  time += 299_000;
  const anotherWorker = createRadioGuide(dependencies);
  expect((await anotherWorker.handle()).headers.get("Cache-Control")).toBe(
    "public, max-age=1"
  );
  expect(requests).toBe(coldRequests);
  time += 1001;
  await anotherWorker.handle();
  expect(requests).toBeGreaterThan(coldRequests);
  dom.window.close();
});

test("slow providers have a hard deadline and at most three concurrent fetches", async () => {
  let active = 0;
  let maximum = 0;
  let aborted = 0;
  const fetchImpl = (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> =>
    new Promise((_resolve, reject) => {
      active += 1;
      maximum = Math.max(maximum, active);
      init?.signal?.addEventListener(
        "abort",
        () => {
          active -= 1;
          aborted += 1;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  const guide = createRadioGuide({
    fetchImpl: fetchImpl as typeof fetch,
    now: () => now,
    providerTimeoutMs: 30,
    timeoutMs: 45,
  });
  const started = performance.now();
  const xml = await (await guide.handle()).text();
  expect(performance.now() - started).toBeLessThan(500);
  expect(maximum).toBe(3);
  expect(active).toBe(0);
  expect(aborted).toBeGreaterThanOrEqual(3);
  expect(xml.match(/<channel /g)).toHaveLength(10);
});

test("oversized and stalled bodies are cancelled while other channels remain available", async () => {
  let cancelled = 0;
  const fetchImpl = (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("nts.live")) {
      return Promise.resolve(Response.json(nts));
    }
    if (url.includes("radio.syg.ma")) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel() {
              cancelled += 1;
            },
          })
        )
      );
    }
    if (url.includes("strapi.lyl.live")) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled += 1;
            },
          })
        )
      );
    }
    return Promise.resolve(new Response(null, { status: 503 }));
  };
  const xml = await (
    await createRadioGuide({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
      providerTimeoutMs: 30,
      timeoutMs: 200,
    }).handle()
  ).text();
  expect(cancelled).toBe(2);
  expect(xml.match(/<programme /g)).toHaveLength(2);
});

test("guide retrieval still blocks private redirects", async () => {
  const requests: string[] = [];
  const fetchImpl = (input: string | URL | Request) => {
    requests.push(String(input));
    return Promise.resolve(Response.redirect("http://127.0.0.1/private", 302));
  };
  const xml = await (
    await createRadioGuide({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
    }).handle()
  ).text();
  expect(requests.some((url) => url.includes("127.0.0.1"))).toBe(false);
  expect(xml).not.toContain("<programme ");
  expect(xml.match(/<channel /g)).toHaveLength(10);
});
