import { describe, expect, test } from "bun:test";
import {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
  isYouTubeUrl,
} from "./detect";

describe("isYouTubeUrl", () => {
  test("recognizes standard YouTube URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      true
    );
    expect(isYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  test("recognizes youtu.be short links", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  test("recognizes YouTube Music URLs", () => {
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      true
    );
  });

  test("rejects non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://example.com")).toBe(false);
    expect(isYouTubeUrl("https://soundcloud.com/artist")).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
  });
});

describe("detectYouTubeItemType", () => {
  test("detects playlist URLs", () => {
    expect(
      detectYouTubeItemType(
        "https://youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
      )
    ).toBe("playlist");
    expect(
      detectYouTubeItemType(
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
      )
    ).toBe("playlist");
  });

  test("detects video URLs", () => {
    expect(
      detectYouTubeItemType("https://youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBe("video");
    expect(detectYouTubeItemType("https://youtu.be/dQw4w9WgXcQ")).toBe("video");
  });
});

describe("extractVideoId", () => {
  test("extracts from standard watch URL", () => {
    expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  test("extracts from youtu.be short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from shorts URL", () => {
    expect(extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  test("extracts from embed URL", () => {
    expect(extractVideoId("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  test("extracts from URL with extra params", () => {
    expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  test("returns null for non-video URL", () => {
    expect(extractVideoId("https://youtube.com/channel/UCtest")).toBeNull();
    expect(extractVideoId("https://example.com")).toBeNull();
  });
});

describe("extractPlaylistId", () => {
  test("extracts playlist ID", () => {
    expect(
      extractPlaylistId(
        "https://youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
      )
    ).toBe("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  });

  test("extracts from video URL with list param", () => {
    expect(
      extractPlaylistId(
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
      )
    ).toBe("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  });

  test("returns null when no playlist", () => {
    expect(
      extractPlaylistId("https://youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBeNull();
  });
});
