import { expect, test } from "@playwright/test";

test("station probes use real browser fetch and preserve provider order", async ({
  page,
}) => {
  const ranges: Array<string | undefined> = [];
  await page.route("https://stream.example/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        headers: {
          "access-control-allow-headers": "Range",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-origin": "*",
        },
        status: 204,
      });
      return;
    }

    ranges.push(request.headers().range);
    const failed = new URL(request.url()).pathname.endsWith("/failed");
    await route.fulfill({
      body: failed ? "unavailable" : "audio",
      headers: {
        "access-control-allow-origin": "*",
        "content-type": failed ? "text/plain" : "audio/mpeg",
      },
      status: failed ? 503 : 206,
    });
  });
  await page.goto("/e2e/testbed.html");

  const playableIds = await page.evaluate(async () => {
    const modulePath = "/src/lib/stations/radio-browser-playability.ts";
    const { filterPlayableRadioBrowserStations } = await import(modulePath);
    const makeStation = (id: string, urlResolved: string) => ({
      bitrate: 128,
      codec: "MP3",
      country: "",
      favicon: "",
      hls: false,
      homepage: "",
      lastCheckOk: true,
      lastCheckTime: "",
      name: id,
      state: "",
      stationUuid: id,
      tags: [],
      url: urlResolved,
      urlResolved,
    });
    const stations = [
      makeStation("first", "https://stream.example/first"),
      makeStation("failed", "https://stream.example/failed"),
      makeStation("insecure", "http://stream.example/insecure"),
      makeStation("last", "https://stream.example/last"),
    ];

    const results = await filterPlayableRadioBrowserStations(stations);
    return results.map(
      (station: { stationUuid: string }) => station.stationUuid
    );
  });

  expect(playableIds).toEqual(["first", "last"]);
  expect(ranges).toEqual(["bytes=0-0", "bytes=0-0", "bytes=0-0"]);
});
