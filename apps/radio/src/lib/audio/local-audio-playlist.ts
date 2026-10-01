import type { Radio } from "@/lib/audio";
import type { StaticAudioMetadata } from "@/lib/platform-types";
import { generateId } from "@/lib/types";
import {
  extractFileMetadata,
  type FileAudioMetadata,
  isAudioFile,
} from "./file-metadata";

function isUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Local URLs owned by a file or folder, including tracks not playing yet.
 * A restored or imported snapshot is read loosely, so a malformed track
 * list counts as none rather than throwing.
 */
export function localAudioUrls(radio: Radio | null | undefined): string[] {
  const metadata = radio?.platformMetadata;
  if (metadata?.platform === "local-file") {
    return [radio?.streamUrl || metadata.objectUrl].filter(isUrl);
  }
  if (metadata?.platform !== "static-audio" || !metadata.isLocal) {
    return [];
  }
  const tracks: unknown = metadata.tracks;
  return [
    ...new Set(
      [
        metadata.streamUrl,
        ...(Array.isArray(tracks)
          ? tracks.map((track: unknown) =>
              typeof track === "object" &&
              track !== null &&
              "streamUrl" in track
                ? track.streamUrl
                : undefined
            )
          : []),
      ].filter(isUrl)
    ),
  ];
}

/** The directory picker includes subfolders; natural path order becomes play order. */
export async function loadLocalAudioPlaylist(
  files: readonly File[],
  loadFile: (file: File) => Promise<FileAudioMetadata> = extractFileMetadata
): Promise<Radio> {
  const ordered = files
    .filter(isAudioFile)
    .sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
        undefined,
        { numeric: true }
      )
    );
  const loaded: FileAudioMetadata[] = [];
  for (const file of ordered) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: probe one file at a time to bound browser media resources
      loaded.push(await loadFile(file));
    } catch {
      // A file with a recognised extension may use a codec this browser cannot play.
    }
  }
  const [first] = loaded;
  if (!first) {
    throw new Error("No playable audio files in this selection");
  }
  const name = files[0]?.webkitRelativePath?.split("/")[0] || "Local playlist";
  const metadata: StaticAudioMetadata = {
    displayName: name,
    duration: loaded.reduce((total, file) => total + file.duration, 0),
    fileName: name,
    fileSize: loaded.reduce((total, file) => total + file.fileSize, 0),
    isLocal: true,
    itemType: "playlist",
    mimeType: first.mimeType,
    platform: "static-audio",
    playlistName: name,
    streamUrl: first.objectUrl,
    tracks: loaded.map((file) => ({
      duration: file.duration,
      streamUrl: file.objectUrl,
      title: file.displayName,
    })),
    url: "",
  };
  return {
    description: `${loaded.length} tracks · ${files.length - loaded.length} skipped`,
    enabled: true,
    id: `local-playlist-${generateId()}`,
    name,
    platformMetadata: metadata,
    streamUrl: first.objectUrl,
  };
}
