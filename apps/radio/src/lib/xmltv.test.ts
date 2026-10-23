import { expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { radios } from "./const";
import { getPublicKodiStations } from "./kodi-playlist";
import type { RadioProgramme } from "./metadata/programmes";
import { renderXmltv } from "./xmltv";

test("XMLTV escapes XML 1.0 text/attributes and aligns channel IDs with M3U", () => {
  const now = Date.parse("2026-10-23T12:30:00Z");
  const stations = getPublicKodiStations(radios);
  const [first] = stations;
  if (!first) {
    throw new Error("Expected default stations");
  }
  const station = {
    ...first,
    id: 'a&"<b>',
    name: "Name & <station>",
    logoUrl: 'https://example.com/logo?a=1&b="2"',
  };
  const programme: RadioProgramme = {
    title: 'Show & <title> "quoted" 🎧\u0001\ud800',
    description: "A & B <live>",
    artworkUrl: "https://example.com/art?a=1&b=2",
    categories: ["Jazz & Soul"],
    start: now - 30 * 60_000,
    end: now + 30 * 60_000,
  };
  const xml = renderXmltv(
    [station, ...stations],
    new Map([
      [station.id, [programme]],
      ["unknown-channel", [programme]],
    ]),
    now
  );
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const doc = dom.window.document;
  expect(
    [...doc.querySelectorAll("channel")].map((channel) => channel.id)
  ).toEqual([station.id, ...stations.map((entry) => entry.id)]);
  expect(doc.querySelectorAll("programme")).toHaveLength(1);
  const slot = doc.querySelector("programme");
  expect(slot?.getAttribute("channel")).toBe(station.id);
  expect(slot?.getAttribute("start")).toBe("20261023120000 +0000");
  expect(slot?.getAttribute("stop")).toBe("20261023130000 +0000");
  expect(slot?.querySelector("title")?.textContent).toBe(
    'Show & <title> "quoted" 🎧'
  );
  expect(slot?.querySelector("desc")?.textContent).toBe("A & B <live>");
  expect(slot?.querySelector("icon")?.getAttribute("src")).toBe(
    programme.artworkUrl
  );
  dom.window.close();
});
