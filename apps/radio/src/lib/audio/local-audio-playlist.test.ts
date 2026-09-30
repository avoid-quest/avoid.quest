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

  test("rejects a selection with no playable files", async () => {
    await expect(
      loadLocalAudioPlaylist(
        [file("Mix/cover.jpg"), file("Mix/broken.mp3")],
        probe
      )
    ).rejects.toThrow("No playable audio files");
  });
});
