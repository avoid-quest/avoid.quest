import { describe, expect, test } from "bun:test";
import { radios } from "@/lib/const";
import {
  browserAudioRadio,
  detectBrowserAudioSource,
} from "./browser-audio-links";
import { detectPlatformFromUrl } from "./external-url/detect";
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
    "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk",
    "https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi",
    "https://www.mixcloud.com/radio/",
    "https://www.mixcloud.com/live/radio/",
  ])("loads %s without a media resolver or credentials", async (url) => {
    const unexpected = () =>
      Promise.reject(new Error("Unexpected provider call"));
    const load = createPlatformItemLoader({
      getYouTubeClient: () => ({ resolveItem: unexpected }),
      resolvePlatformItem: unexpected,
      resolveSpotifyItem: unexpected,
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
    "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
    "https://open.spotify.com/intl-de/album/2noRn2Aes5aoNVsU6iWThc?si=x",
    "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2",
    "https://spotify.link/h5TbcGLLkhb",
    "https://www.mixcloud.com/dholbach/cryptkeeper/",
    "https://m.mixcloud.com/NTSRadio/show/",
  ])("plays %s as a platform track, not a shared tab", (url) => {
    expect(detectBrowserAudioSource(url)).toBeNull();
    expect(detectPlatformFromUrl(url)).toBe(
      url.includes("mixcloud") ? "mixcloud" : "spotify"
    );
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
  test.each(radios.filter((radio) => radio.streamUrl))(
    "keeps the $name live stream on the stream loader",
    (radio) => expect(detectBrowserAudioSource(radio.streamUrl)).toBeNull()
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
