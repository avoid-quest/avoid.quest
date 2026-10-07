import { expect, spyOn, test } from "bun:test";
import type { FetchLike } from "../redirects/validated-redirects.js";
import { type BandcampItemOptions, getBandcampItem } from "./index.js";

const url = "https://artist.bandcamp.com/track/song";
const streamUrl = "https://t4.bcbits.com/stream/song/mp3-128/123";
const relays = [
  "https://relay-one.example/",
  "https://relay-two.example/",
] as const;
const unsafeStream = "https://evil.example%2F@t4.bcbits.com/stream/a";
function page(
  streams: (string | null)[] = [streamUrl],
  image = "https://f4.bcbits.com/img/art.jpg",
  identity: string | null = url,
  ogUrl?: string
) {
  const basic = JSON.stringify({
    byArtist: { name: "Artist" },
    image,
    name: "Song",
  });
  const trackinfo = streams.map((stream) => ({
    duration: 120,
    file: stream ? { "mp3-128": stream } : null,
    title: "Song",
  }));
  return `${ogUrl === undefined ? "" : `<meta property="og:url" content="${ogUrl}">`}<script type="application/ld+json">${basic}</script><script data-tralbum='${JSON.stringify({ trackinfo, url: identity ?? undefined })}'></script>`;
}
function options(
  impl: (...args: Parameters<FetchLike>) => Response | Promise<Response>,
  signal?: AbortSignal
): BandcampItemOptions {
  return {
    fetchImpl: (target, init) => {
      if (init?.redirect === "error") {
        throw new TypeError(
          'Invalid redirect value, must be "follow" or "manual"'
        );
      }
      return Promise.resolve(impl(target, init));
    },
    relayBaseUrls: relays,
    signal,
  };
}

function resolve(body: string, target = url) {
  return getBandcampItem(
    target,
    options((destination) => {
      expect(destination).toBe(target);
      return new Response(body);
    })
  );
}

test.each([url, url.replace("https:", "http:"), url.replace("com/", "com./")])(
  "canonicalizes %s",
  async (target) => {
    const result = await getBandcampItem(
      target,
      options(() => new Response(page()))
    );
    expect(result).toMatchObject({
      metadata: {
        artwork: "https://f4.bcbits.com/img/art.jpg",
        itemType: "track",
        url,
      },
      streamUrl,
      success: true,
    });
  }
);

test.each([
  ["album", "other.bandcamp.com"],
  ["track", "other.bandcamp.com"],
  ["album", "attacker.example"],
  ["track", "attacker.example"],
])("%s direct redirect to %s", async (kind, host) => {
  const target = url.replace("/track/", `/${kind}/`);
  const destination = `https://${host}/${kind}/song`;
  const destinations: string[] = [];
  const result = await getBandcampItem(
    target,
    options((request) => {
      destinations.push(new URL(request).hostname);
      return request === target
        ? Response.redirect(destination, 302)
        : new Response(page([streamUrl], undefined, target, destination));
    })
  );
  expect(result.success).toBe(host === "other.bandcamp.com");
  expect(destinations).toEqual(
    host === "other.bandcamp.com"
      ? ["artist.bandcamp.com", host]
      : ["artist.bandcamp.com"]
  );
});

test.each(["album", "track"])(
  "%s relay rejects a redirect to another Bandcamp hostname without a final URL",
  async (kind) => {
    const target = url.replace("/track/", `/${kind}/`);
    const destinations: string[] = [];
    const result = await getBandcampItem(
      target,
      options((request) => {
        destinations.push(new URL(request).hostname);
        return new Response(
          request === target
            ? "Challenge"
            : page(
                [streamUrl],
                undefined,
                target,
                `https://other.bandcamp.com/${kind}/song`
              )
        );
      })
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("page hostname does not match request"),
      success: false,
    });
    expect(destinations).toEqual([
      "artist.bandcamp.com",
      "relay-one.example",
      "relay-two.example",
    ]);
  }
);

test.each(["network", "markup", "HTTP"])(
  "falls back after direct %s failure on Workers",
  async (failure) => {
    const canonical = `${url}?next=%2Falbum%2Fa&tag=a%26b`;
    const result = await getBandcampItem(
      `${canonical}#fragment`,
      options((target) => {
        const request = new URL(target);
        if (request.hostname === "artist.bandcamp.com") {
          if (failure === "network") {
            throw new Error("Unavailable");
          }
          return new Response("Challenge", {
            status: failure === "markup" ? 200 : 503,
          });
        }
        const destination = decodeURIComponent(request.pathname.slice(1));
        expect(destination).toBe(canonical);
        return new Response(page());
      })
    );
    expect(result).toMatchObject({
      metadata: { url: canonical },
      streamUrl,
      success: true,
    });
  }
);

test.each([
  "https://evil.example%2F@artist.bandcamp.com/track/a",
  "https://169.254.169.254%2F@artist.bandcamp.com/track/a",
  "https://user:password@artist.bandcamp.com/track/a",
  "https://artist.bandcamp.com:8443/track/a",
  "https://bandcamp.com.evil.example/track/a",
  "https://custom-artist.example/track/a",
])("rejects unsafe targets before fetching: %s", async (target) => {
  let fetched = false;
  const result = await getBandcampItem(
    target,
    options(() => {
      fetched = true;
      return new Response(page());
    })
  );
  expect(result.success).toBe(false);
  expect(fetched).toBe(false);
});

test.each(["album", "track"])(
  "%s relay accepts same-host identity after a slug rename without final-URL headers",
  async (kind) => {
    const target = url.replace("/track/", `/${kind}/`);
    const result = await getBandcampItem(
      target,
      options(
        (destination) =>
          new Response(
            destination === target
              ? "Challenge"
              : page([streamUrl], undefined, target.replace("song", "renamed"))
          )
      )
    );
    expect(result).toMatchObject({ streamUrl, success: true });
  }
);

test.each([
  null,
  "https://other.bandcamp.com/track/song",
  "https://artist.bandcamp.com:8443/track/song",
  "https://evil.example/track/a",
  "https://169.254.169.254/track/a",
  "https://evil.example%2F@artist.bandcamp.com/track/a",
])(
  "wrong or missing page identity falls through then fails closed: %s",
  async (identity) => {
    const responses: Response[] = [];
    const destinations: string[] = [];
    const result = await getBandcampItem(
      url,
      options((target) => {
        destinations.push(new URL(target).hostname);
        const response = new Response(page([streamUrl], undefined, identity));
        responses.push(response);
        return response;
      })
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("Failed to parse Bandcamp data:"),
      success: false,
    });
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
    expect(destinations).toEqual([
      "artist.bandcamp.com",
      "relay-one.example",
      "relay-two.example",
    ]);
  }
);

test.each(["direct", "relay"])(
  "%s resolves custom-domain releases using the requested og:url host",
  async (source) => {
    const target = "https://zoekeating.bandcamp.com/album/into-the-trees";
    const result = await getBandcampItem(
      target,
      options(
        (destination) =>
          new Response(
            source === "relay" && destination === target
              ? "Challenge"
              : page(
                  [streamUrl],
                  undefined,
                  "https://music.zoekeating.com/album/into-the-trees",
                  target
                )
          )
      )
    );
    expect(result).toMatchObject({
      metadata: { itemType: "album", url: target },
      streamUrl,
      success: true,
    });
  }
);

test.each([
  "https://other.bandcamp.com/track/song",
  "https://attacker.example/track/song",
  "https://artist.bandcamp.com:8443/track/song",
  "",
])(
  "invalid og:url fails closed despite matching tralbum URL: %s",
  async (ogUrl) => {
    const destinations: string[] = [];
    const result = await getBandcampItem(
      url,
      options((target) => {
        destinations.push(new URL(target).hostname);
        return new Response(page([streamUrl], undefined, url, ogUrl));
      })
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("Failed to parse Bandcamp data:"),
      success: false,
    });
    expect(destinations).toEqual([
      "artist.bandcamp.com",
      "relay-one.example",
      "relay-two.example",
    ]);
  }
);

test("a wrong relay page falls through to a matching page", async () => {
  const result = await getBandcampItem(
    url,
    options(
      (target) =>
        new Response(
          target === url
            ? "Challenge"
            : page(
                [streamUrl],
                undefined,
                target.startsWith(relays[0])
                  ? "https://other.bandcamp.com/track/song"
                  : url
              )
        )
    )
  );
  expect(result).toMatchObject({ streamUrl, success: true });
});

test("rejects and discards relay redirects without trying another relay", async () => {
  const rejected = new Response("discard", {
    headers: { Location: "https://evil.example/track/a" },
    status: 302,
  });
  const destinations: string[] = [];
  const result = await getBandcampItem(
    url,
    options((target) => {
      destinations.push(new URL(target).hostname);
      if (target === url) {
        return new Response("Challenge");
      }
      return rejected;
    })
  );
  expect(result.success).toBe(false);
  expect(rejected.bodyUsed).toBe(true);
  expect(destinations).toEqual(["artist.bandcamp.com", "relay-one.example"]);
});

test.each([
  ["album", null],
  ["track", null],
  ["album", unsafeStream],
  ["track", unsafeStream],
  ["album", "https://media.example/song.mp3"],
  ["track", "https://media.example/song.mp3"],
])(
  "%s with stream %s reports no playable tracks without relaying",
  async (kind, stream) => {
    expect(
      await resolve(page([stream]), url.replace("/track/", `/${kind}/`))
    ).toMatchObject({
      error: expect.stringContaining("No playable tracks"),
      success: false,
    });
  }
);

const links = Array.from(
  { length: 9 },
  (_, index) => `<a href="http://artist.bandcamp.com/album/${index}">Track</a>`
).join("");
const listing = `${links}<a href="https://evil.example/album/a">Foreign</a><a href="https://evil.example%2F@artist.bandcamp.com/album/a">Credentials</a><a href="https://artist.bandcamp.com/music?next=/album/a">Recursive</a><meta property="og:image" content="https://attacker.example/art.jpg">`;

test.each(["artist", "collection"])(
  "%s bounds concurrency, preserves order, and ignores unsafe links and artwork",
  async (kind) => {
    let active = 0;
    let peak = 0;
    const result = await getBandcampItem(
      kind === "artist"
        ? "https://artist.bandcamp.com"
        : "https://bandcamp.com/listener",
      options(async (target) => {
        const request = new URL(target);
        expect(request.protocol).toBe("https:");
        if (["/music", "/listener"].includes(request.pathname)) {
          return new Response(listing);
        }
        expect(request.hostname).toBe("artist.bandcamp.com");
        expect(request.pathname.startsWith("/album/")).toBe(true);
        active += 1;
        peak = Math.max(peak, active);
        await Bun.sleep(10 - Number(request.pathname.split("/").at(-1)));
        active -= 1;
        return new Response(
          page(
            [streamUrl, unsafeStream],
            "https://attacker.example/art.jpg"
          ).replaceAll('"Song"', JSON.stringify(request.pathname))
        );
      })
    );
    expect(result).toMatchObject({
      metadata: { artwork: undefined },
      success: true,
    });
    expect(peak).toBeLessThanOrEqual(4);
    if (result.success) {
      expect(result.metadata.tracks?.map((track) => track.name)).toEqual(
        Array.from({ length: 9 }, (_, index) =>
          kind === "artist"
            ? `/album/${index} - /album/${index}`
            : `Artist - /album/${index}`
        )
      );
    }
  }
);

test("the Workers collection API maps only safe release links", async () => {
  const result = await getBandcampItem(
    "https://bandcamp.com/listener",
    options((target, init) => {
      expect(init?.redirect).toBe("manual");
      if (target.endsWith("/listener")) {
        return new Response('<div data-fan-id="123"></div>');
      }
      if (target.includes("/api/")) {
        return Response.json({
          items: [
            url,
            "https://evil.example/track/a",
            "https://artist.bandcamp.com/music",
          ].map((item_url) => ({ item_url })),
        });
      }
      expect(target).toBe(url);
      return new Response(page());
    })
  );
  expect(result).toMatchObject({
    metadata: { itemType: "collection", trackCount: 1 },
    streamUrl,
    success: true,
  });
});

test("one item deadline stops child loads and relay retries", async () => {
  const signal = AbortSignal.timeout(20);
  const signals: (AbortSignal | null | undefined)[] = [];
  const result = await getBandcampItem(
    "https://artist.bandcamp.com",
    options((target, init) => {
      signals.push(init?.signal);
      if (target.endsWith("/music")) {
        return new Response(links);
      }
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        )
      );
    }, signal)
  );
  expect(result.success).toBe(false);
  expect(signals).toEqual(new Array(5).fill(signal));
});

test("an artist deadline keeps releases that finished among ten slow releases", async () => {
  const signal = AbortSignal.timeout(40);
  const result = await getBandcampItem(
    "https://artist.bandcamp.com",
    options(async (target, init) => {
      if (target.endsWith("/music")) {
        return new Response(
          Array.from(
            { length: 10 },
            (_, index) => `<a href="/album/${index}">Release</a>`
          ).join("")
        );
      }
      if (["/album/0", "/album/1"].includes(new URL(target).pathname)) {
        await Bun.sleep(5);
        return new Response(
          page().replaceAll('"Song"', JSON.stringify(target))
        );
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        )
      );
    }, signal)
  );
  expect(signal.aborted).toBe(true);
  expect(result).toMatchObject({
    metadata: {
      trackCount: 2,
      tracks: [
        {
          name: "https://artist.bandcamp.com/album/0 - https://artist.bandcamp.com/album/0",
        },
        {
          name: "https://artist.bandcamp.com/album/1 - https://artist.bandcamp.com/album/1",
        },
      ],
    },
    success: true,
  });
});

test.each(["network", "HTTP", "markup"])(
  "direct %s fallback logs one bounded diagnostic without private data",
  async (failure) => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const title = `Bandcamp ${"challenge ".repeat(20)}`;
    const body = `<title>${title}</title>captcha private-body 203.0.113.8`;
    const target = `${url}?private-query=secret`;
    const status = failure === "HTTP" ? 403 : 200;
    try {
      const result = await getBandcampItem(
        target,
        options((destination) => {
          if (destination !== target) {
            return new Response("Relay challenge");
          }
          if (failure === "network") {
            throw new Error("private-network-error");
          }
          return new Response(body, {
            headers: {
              "cf-mitigated": "challenge",
              "content-length": String(body.length),
              "content-type": "text/html",
              server: "cloudflare".repeat(20),
              "set-cookie": "private-cookie=secret",
            },
            status,
          });
        })
      );
      expect(result.success).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual([
        {
          bodyLength: failure === "network" ? 0 : body.length,
          hasChallenge: failure !== "network",
          hasJsonLd: false,
          hasTralbum: false,
          headers:
            failure === "network"
              ? {}
              : {
                  "cf-mitigated": "challenge",
                  "content-length": String(body.length),
                  "content-type": "text/html",
                  server: "cloudflare".repeat(20).slice(0, 80),
                },
          hostname: "artist.bandcamp.com",
          stage: "bandcamp-direct",
          status: failure === "network" ? null : status,
          title: failure === "network" ? "" : title.trim().slice(0, 80),
        },
      ]);
    } finally {
      warn.mockRestore();
    }
  }
);

test.each(["artist", "collection"])(
  "%s logs direct fallback once across listing and child pages per load",
  async (kind) => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const target =
      kind === "artist"
        ? "https://artist.bandcamp.com"
        : "https://bandcamp.com/listener";
    const loadOptions = options((destination) => {
      const request = new URL(destination);
      if (!request.hostname.startsWith("relay-")) {
        return new Response("Challenge");
      }
      const pageUrl = new URL(decodeURIComponent(request.pathname.slice(1)));
      return new Response(
        ["/music", "/listener"].includes(pageUrl.pathname) ? listing : page()
      );
    });
    try {
      expect(await getBandcampItem(target, loadOptions)).toMatchObject({
        metadata: { trackCount: 9 },
        success: true,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await getBandcampItem(target, loadOptions)).toMatchObject({
        success: true,
      });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  }
);

test.each(["direct", "relay"])(
  "%s HTTP failure cancels its body after only the required diagnostic sample",
  async (source) => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    let cancelled = false;
    let reads = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        cancel() {
          cancelled = true;
        },
        pull(controller) {
          reads += 1;
          if (reads <= 3) {
            controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
          } else {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 }
    );
    try {
      const result = await getBandcampItem(
        url,
        options((destination) => {
          const failedTarget = source === "direct" ? url : relays[0];
          if (destination.startsWith(failedTarget)) {
            return new Response(body, { status: 503 });
          }
          return new Response(destination === url ? "Challenge" : page());
        })
      );
      expect(result).toMatchObject({ streamUrl, success: true });
      expect(cancelled).toBe(true);
      expect(reads).toBe(source === "direct" ? 1 : 0);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        bodyLength: source === "direct" ? 8192 : "Challenge".length,
      });
    } finally {
      warn.mockRestore();
    }
  }
);

test("direct failures without a relay and purchase-only pages emit no fallback diagnostic", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    expect(
      await getBandcampItem(url, {
        fetchImpl: async () => new Response("Challenge"),
      })
    ).toMatchObject({ success: false });
    expect(await resolve(page([null]))).toMatchObject({ success: false });
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});
