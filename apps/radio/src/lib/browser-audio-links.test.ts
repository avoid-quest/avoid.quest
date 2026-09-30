import { describe, expect, test } from "bun:test";
import { radios } from "@/lib/const";
import {
  browserAudioRadio,
  detectBrowserAudioSource,
} from "./browser-audio-links";
import { setSourceRadio } from "./node-graph/graph-edits";
import { buildNodeGraphFromTemplate } from "./node-graph/templates";
import { createPlatformItemLoader } from "./platform-item-loader";

describe("hosted audio links", () => {
  test.each(radios.filter((radio) => radio.websiteUrl))(
    "recognises episode and show pages on $name",
    (radio) => {
      expect(
        detectBrowserAudioSource(
          new URL("/shows/test/episodes/2026-10-01", radio.websiteUrl).href
        )
      ).toBe("radio-shows");
    }
  );
  test.each([
    "https://open.spotify.com/track/abc",
    "https://open.spotify.com/playlist/abc",
    "https://open.spotify.com/episode/abc",
    "https://spotify.link/abc",
    "https://www.mixcloud.com/radio/show/",
  ])("loads %s without a media resolver or credentials", async (url) => {
    const unexpected = () =>
      Promise.reject(new Error("Unexpected provider call"));
    const load = createPlatformItemLoader({
      getYouTubeClient: () => ({ resolveItem: unexpected }),
      resolvePlatformItem: unexpected,
      resolveStaticAudio: unexpected,
    });
    const result = await load(url);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.radio.platformMetadata).toMatchObject({
        capture: "display",
        sourceUrl: url,
      });
      const graph = buildNodeGraphFromTemplate("starter");
      const source = graph.nodes.find((node) => node.type === "station");
      if (!source) {
        throw new Error("Expected starter source");
      }
      const converted = setSourceRadio(graph, source.id, result.radio);
      expect(converted.nodes.find((node) => node.id === source.id)?.type).toBe(
        "deviceIn"
      );
      expect(converted.edges).toEqual(graph.edges);
    }
  });
  test.each([
    "https://nts.live.evil.example/shows/test",
    "https://open.spotify.com.evil.example/track/abc",
    "https://user:password@mixcloud.com/radio/show/",
    "javascript:alert(1)",
    "http://localhost/show",
  ])("rejects unsafe or spoofed hosted URL %s", (url) =>
    expect(detectBrowserAudioSource(url)).toBeNull()
  );
  test("direct recordings still use the normal seekable audio loader", () => {
    expect(
      detectBrowserAudioSource("https://radioblackout.org/episodes/show.mp3")
    ).toBeNull();
    expect(browserAudioRadio("https://www.nts.live/shows/test").streamUrl).toBe(
      ""
    );
  });
});
