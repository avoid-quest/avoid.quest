import { describe, expect, test } from "bun:test";
import { findNextTrack } from "@/lib/dj-actions-playlist";
import { getCurrentTrackIndex } from "@/lib/external-url/metadata-helpers";
import { loadLocalAudioPlaylist, localAudioUrls } from "./local-audio-playlist";

function file(path: string): File {
  const picked = new File(["audio"], path.split("/").at(-1) ?? path);
  Object.defineProperty(picked, "webkitRelativePath", { value: path });
  return picked;
}

const probe = (picked: File) => {
  if (picked.name === "broken.mp3") {
    return Promise.reject(new Error("Unsupported codec"));
  }
  return Promise.resolve({
    displayName: picked.name,
    duration: 10,
    fileName: picked.name,
    fileSize: picked.size,
    mimeType: "audio/mpeg",
    objectUrl: `blob:${picked.webkitRelativePath}`,
  });
};

describe("local folder playlist", () => {
  test("imports nested files in natural order and skips non-audio and broken codecs", async () => {
    const radio = await loadLocalAudioPlaylist(
      [
        file("Mix/10.mp3"),
        file("Mix/2.mp3"),
        file("Mix/sub/1.wav"),
        file("Mix/cover.jpg"),
        file("Mix/broken.mp3"),
      ],
      probe
    );
    expect(radio.name).toBe("Mix");
    expect(radio.description).toBe("3 tracks · 2 skipped");
    expect(localAudioUrls(radio)).toEqual([
      "blob:Mix/2.mp3",
      "blob:Mix/10.mp3",
      "blob:Mix/sub/1.wav",
    ]);
    expect(findNextTrack(radio)?.streamUrl).toBe("blob:Mix/10.mp3");
    const next = { ...radio, streamUrl: "blob:Mix/10.mp3" };
    if (!next.platformMetadata) {
      throw new Error("Expected playlist metadata");
    }
    expect(getCurrentTrackIndex(next.platformMetadata, next.streamUrl)).toBe(1);
    expect(findNextTrack(next)?.streamUrl).toBe("blob:Mix/sub/1.wav");
    expect(
      findNextTrack({ ...radio, streamUrl: "blob:Mix/sub/1.wav" })
    ).toBeNull();
  });

  test("reads a malformed stored track list as no tracks", () => {
    const stored = (tracks: unknown) =>
      localAudioUrls({
        name: "Mix",
        platformMetadata: {
          isLocal: true,
          platform: "static-audio",
          streamUrl: "blob:mix/1.mp3",
          tracks,
        } as never,
        streamUrl: "blob:mix/1.mp3",
      });

    expect(stored({ 0: "blob:mix/2.mp3" })).toEqual(["blob:mix/1.mp3"]);
    expect(stored("blob:mix/2.mp3")).toEqual(["blob:mix/1.mp3"]);
    expect(
      stored([null, { streamUrl: 2 }, { streamUrl: "blob:mix/2.mp3" }])
    ).toEqual(["blob:mix/1.mp3", "blob:mix/2.mp3"]);
  });

  test("rejects a selection with no playable files", async () => {
    await expect(
      loadLocalAudioPlaylist(
        [file("Mix/cover.jpg"), file("Mix/broken.mp3")],
        probe
      )
    ).rejects.toThrow("No playable audio files");
  });

  test("stops probing once the load is superseded, returning what it probed", async () => {
    const probed: string[] = [];
    const radio = await loadLocalAudioPlaylist(
      [
        file("Mix/1.mp3"),
        file("Mix/2.mp3"),
        file("Mix/3.mp3"),
        file("Mix/4.mp3"),
      ],
      (picked) => {
        probed.push(picked.name);
        return probe(picked);
      },
      () => probed.length < 2
    );

    expect(probed).toEqual(["1.mp3", "2.mp3"]);
    // The caller discards a superseded playlist and releases these URLs.
    expect(localAudioUrls(radio)).toEqual(["blob:Mix/1.mp3", "blob:Mix/2.mp3"]);
  });
});
