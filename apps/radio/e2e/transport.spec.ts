import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  expect,
  type Page,
  type Route,
  test,
} from "@playwright/test";

const MEDIA_ORIGIN = "https://media.example.test";
const BYTE_RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;
const FIXTURE_DIRECTORY = fileURLToPath(
  new URL("./fixtures/media/", import.meta.url)
);

type MediaFixture = {
  body: Buffer;
  contentType: string;
};

type InstalledMediaRoutes = {
  progressiveAResponse: Promise<void>;
  requests: string[];
};

async function fulfillMediaRoute(
  route: Route,
  fixture: MediaFixture
): Promise<void> {
  const headers: Record<string, string> = {
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": fixture.contentType,
    "cross-origin-resource-policy": "cross-origin",
  };
  const range = route.request().headers().range?.match(BYTE_RANGE_PATTERN);
  if (!range) {
    await route.fulfill({ body: fixture.body, headers, status: 200 });
    return;
  }

  const start = Number(range[1]);
  const requestedEnd = range[2] ? Number(range[2]) : fixture.body.length - 1;
  const end = Math.min(requestedEnd, fixture.body.length - 1);
  if (start >= fixture.body.length || end < start) {
    await route.fulfill({
      body: "",
      headers: {
        ...headers,
        "content-range": `bytes */${fixture.body.length}`,
      },
      status: 416,
    });
    return;
  }

  await route.fulfill({
    body: fixture.body.subarray(start, end + 1),
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${fixture.body.length}`,
    },
    status: 206,
  });
}

async function installMediaRoutes(
  context: BrowserContext
): Promise<InstalledMediaRoutes> {
  const [wave, manifest, ...segments] = await Promise.all([
    readFile(`${FIXTURE_DIRECTORY}tone.wav`),
    readFile(`${FIXTURE_DIRECTORY}playlist.m3u8`),
    readFile(`${FIXTURE_DIRECTORY}segment-00.m2ts`),
    readFile(`${FIXTURE_DIRECTORY}segment-01.m2ts`),
    readFile(`${FIXTURE_DIRECTORY}segment-02.m2ts`),
    readFile(`${FIXTURE_DIRECTORY}segment-03.m2ts`),
  ]);
  const fixtures = new Map<string, MediaFixture>([
    ["/progressive-a.wav", { body: wave, contentType: "audio/wav" }],
    ["/progressive-b.wav", { body: wave, contentType: "audio/wav" }],
    [
      "/playlist.m3u8",
      { body: manifest, contentType: "application/vnd.apple.mpegurl" },
    ],
    ...segments.map(
      (body, index) =>
        [
          `/segment-${index.toString().padStart(2, "0")}.m2ts`,
          { body, contentType: "video/mp2t" },
        ] as const
    ),
  ]);
  const requests: string[] = [];
  let resolveProgressiveAResponse: () => void = () => undefined;
  const progressiveAResponse = new Promise<void>((resolve) => {
    resolveProgressiveAResponse = resolve;
  });

  await context.route(
    "https://cloudflare-dns.com/dns-query**",
    async (route) => {
      const requestUrl = new URL(route.request().url());
      const recordType = requestUrl.searchParams.get("type");
      const answers =
        recordType === "A" || recordType === "1"
          ? [
              {
                TTL: 60,
                data: "93.184.216.34",
                name: "media.example.test",
                type: 1,
              },
            ]
          : [];
      await route.fulfill({
        body: JSON.stringify({ Answer: answers, Status: 0 }),
        contentType: "application/dns-json",
        headers: {
          "access-control-allow-origin": "*",
          "cross-origin-resource-policy": "cross-origin",
        },
        status: 200,
      });
    }
  );

  await context.route(`${MEDIA_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const fixture = fixtures.get(path);
    if (!fixture) {
      await route.fulfill({ body: "Not found", status: 404 });
      return;
    }

    requests.push(path);
    if (path === "/progressive-a.wav") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await fulfillMediaRoute(route, fixture);
      } catch (error) {
        if (!route.request().failure()) {
          throw error;
        }
      } finally {
        resolveProgressiveAResponse();
      }
      return;
    }
    await fulfillMediaRoute(route, fixture);
  });

  return { progressiveAResponse, requests };
}

async function openTestbed(page: Page): Promise<void> {
  await page.goto("/e2e/testbed.html");
  await expect(page.locator("body")).toBeVisible();
}

test("supersedes a pending progressive load without stale callbacks", async ({
  context,
  page,
}) => {
  const mediaRoutes = await installMediaRoutes(context);
  await openTestbed(page);

  const firstRequest = page.waitForRequest(`${MEDIA_ORIGIN}/progressive-a.wav`);
  await page.evaluate(async (firstUrl) => {
    const { MediaElementPlaybackSource } = await import(
      "../src/lib/audio/playback/media-element-playback-source.ts"
    );
    const audioContext = new AudioContext();
    const events = { ended: 0, errors: [] as string[], ready: 0 };
    const source = new MediaElementPlaybackSource(
      audioContext,
      "browser-transport",
      {
        onEnded: () => {
          events.ended += 1;
        },
        onError: (error) => {
          events.errors.push(error.message);
        },
        onReady: () => {
          events.ready += 1;
        },
      }
    );
    source.output.connect(audioContext.destination);
    const firstLoad = source
      .load({ format: "progressive", src: firstUrl })
      .then(
        () => "resolved",
        (error: unknown) =>
          error instanceof Error ? error.name : "unknown-error"
      );
    Object.assign(window, {
      __transportContext: audioContext,
      __transportEvents: events,
      __transportFirstLoad: firstLoad,
      __transportSource: source,
    });
  }, `${MEDIA_ORIGIN}/progressive-a.wav`);
  await firstRequest;

  const initial = await page.evaluate(async (secondUrl) => {
    const testWindow = window as typeof window & {
      __transportContext: AudioContext;
      __transportEvents: {
        ended: number;
        errors: string[];
        ready: number;
      };
      __transportFirstLoad: Promise<string>;
      __transportSource: {
        load(input: { format: "progressive"; src: string }): Promise<void>;
        play(): Promise<void>;
        status: string;
      };
    };
    const { __transportContext: audioContext, __transportSource: source } =
      testWindow;
    await source.load({ format: "progressive", src: secondUrl });

    const playButton = document.createElement("button");
    playButton.dataset.testid = "play-transport";
    playButton.textContent = "Play";
    playButton.addEventListener(
      "click",
      () => {
        const playResult = audioContext
          .resume()
          .then(() => source.play())
          .then(
            () => "resolved",
            (error: unknown) =>
              error instanceof Error ? error.name : "unknown-error"
          );
        Object.assign(window, { __transportPlayResult: playResult });
      },
      { once: true }
    );
    document.documentElement.append(playButton);

    return {
      firstLoad: await testWindow.__transportFirstLoad,
      readyCount: testWindow.__transportEvents.ready,
      status: source.status,
    };
  }, `${MEDIA_ORIGIN}/progressive-b.wav`);

  expect(initial).toEqual({
    firstLoad: "AbortError",
    readyCount: 1,
    status: "buffering",
  });
  await page.getByTestId("play-transport").click();
  await page.waitForFunction(async () => {
    const testWindow = window as typeof window & {
      __transportPlayResult?: Promise<string>;
      __transportSource?: { currentTime: number; status: string };
    };
    return (
      (await testWindow.__transportPlayResult) === "resolved" &&
      testWindow.__transportSource?.status === "streaming" &&
      (testWindow.__transportSource?.currentTime ?? 0) > 0.05
    );
  });

  await mediaRoutes.progressiveAResponse;
  const stopped = await page.evaluate(async () => {
    const testWindow = window as typeof window & {
      __transportContext: AudioContext;
      __transportEvents: { ended: number; errors: string[]; ready: number };
      __transportSource: {
        cleanup(): void;
        currentTime: number;
        status: string;
        stop(): void;
      };
    };
    testWindow.__transportSource.stop();
    const result = {
      currentTime: testWindow.__transportSource.currentTime,
      endedCount: testWindow.__transportEvents.ended,
      errors: testWindow.__transportEvents.errors,
      readyCount: testWindow.__transportEvents.ready,
      status: testWindow.__transportSource.status,
    };
    testWindow.__transportSource.cleanup();
    await testWindow.__transportContext.close();
    return result;
  });

  expect(stopped).toMatchObject({
    endedCount: 1,
    errors: [],
    readyCount: 1,
    status: "ended",
  });
  expect(stopped.currentTime).toBeLessThanOrEqual(0.01);
});

test("plays HLS through the real hls.js MediaSource lifecycle", async ({
  context,
  page,
}) => {
  const { requests } = await installMediaRoutes(context);
  await openTestbed(page);

  const loaded = await page.evaluate(async (src) => {
    const { MediaElementPlaybackSource } = await import(
      "../src/lib/audio/playback/media-element-playback-source.ts"
    );
    const audioContext = new AudioContext();
    const source = new MediaElementPlaybackSource(audioContext, "browser-hls");
    source.output.connect(audioContext.destination);
    await source.load({ format: "hls", src });

    const internals = source as unknown as {
      audio: HTMLAudioElement;
      hls: { media: HTMLMediaElement | null } | null;
    };
    const playButton = document.createElement("button");
    playButton.dataset.testid = "play-hls";
    playButton.textContent = "Play HLS";
    playButton.addEventListener(
      "click",
      () => {
        const playResult = audioContext
          .resume()
          .then(() => source.play())
          .then(
            () => "resolved",
            (error: unknown) =>
              error instanceof Error ? error.name : "unknown-error"
          );
        Object.assign(window, { __hlsPlayResult: playResult });
      },
      { once: true }
    );
    document.documentElement.append(playButton);
    Object.assign(window, { __hlsContext: audioContext, __hlsSource: source });

    return {
      attachedToRealElement: internals.hls?.media === internals.audio,
      currentSourceProtocol: new URL(internals.audio.currentSrc).protocol,
      status: source.status,
    };
  }, `${MEDIA_ORIGIN}/playlist.m3u8`);

  expect(loaded).toEqual({
    attachedToRealElement: true,
    currentSourceProtocol: "blob:",
    status: "buffering",
  });
  await page.getByTestId("play-hls").click();
  await page.waitForFunction(async () => {
    const testWindow = window as typeof window & {
      __hlsPlayResult?: Promise<string>;
      __hlsSource?: { currentTime: number; status: string };
    };
    return (
      (await testWindow.__hlsPlayResult) === "resolved" &&
      testWindow.__hlsSource?.status === "streaming" &&
      (testWindow.__hlsSource?.currentTime ?? 0) > 0.05
    );
  });

  const cleanedUp = await page.evaluate(async () => {
    const testWindow = window as typeof window & {
      __hlsContext: AudioContext;
      __hlsSource: { cleanup(): void; status: string };
    };
    const internals = testWindow.__hlsSource as unknown as {
      audio: HTMLAudioElement;
      hls: unknown;
    };
    testWindow.__hlsSource.cleanup();
    const result = {
      hls: internals.hls,
      sourceAttribute: internals.audio.getAttribute("src"),
      status: testWindow.__hlsSource.status,
    };
    await testWindow.__hlsContext.close();
    return result;
  });

  expect(cleanedUp).toEqual({
    hls: null,
    sourceAttribute: null,
    status: "idle",
  });
  expect(requests).toContain("/playlist.m3u8");
  expect(requests.some((path) => path.endsWith(".m2ts"))).toBe(true);
});
