/**
 * Node Sources
 *
 * Which Source node holds a radio, and whether a local file still plays.
 * A Station holds live radio, a Track ("platform") a YouTube, SoundCloud or
 * Bandcamp item, and a File a local file or a static audio URL. Filling any
 * of them with another kind of radio turns it into the right one in place.
 *
 * A local file plays from a `blob:` object URL that dies with the page, so
 * the URLs picked in this page are kept here. A File whose URL is not one of
 * them was restored from storage: it keeps its name but has no lane until
 * the file is picked again.
 */

import type { Radio } from "@/lib/audio";
import type { FileAudioMetadata } from "@/lib/audio/file-metadata";
import { localAudioUrls } from "@/lib/audio/local-audio-playlist";
import {
  getCurrentTrackIndex,
  isCollection,
} from "@/lib/external-url/metadata-helpers";
import { getRetainedNodeGraphs, nodeStore } from "./node-store";
import { isRadioSourceNode, type RadioSourceNodeType } from "./schema";

/** Platforms a Track plays; each stream URL expires and must be refreshed. */
const TRACK_PLATFORMS: ReadonlySet<string> = new Set([
  "bandcamp",
  "soundcloud",
  "youtube",
]);

const FILE_PLATFORMS: ReadonlySet<string> = new Set([
  "local-file",
  "static-audio",
]);

/** A loose radio snapshot, as graph nodes hold it. */
type RadioLike = { platformMetadata?: unknown; streamUrl: string };

function platformOf(radio: RadioLike | null | undefined): string {
  const metadata = radio?.platformMetadata;
  return metadata && typeof metadata === "object" && "platform" in metadata
    ? String(metadata.platform)
    : "";
}

/** The Source node type that plays `radio`. */
export function sourceTypeForRadio(radio: RadioLike): RadioSourceNodeType {
  const platform = platformOf(radio);
  if (TRACK_PLATFORMS.has(platform)) {
    return "platform";
  }
  return FILE_PLATFORMS.has(platform) ? "file" : "station";
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  bandcamp: "Bandcamp",
  "local-file": "Local file",
  soundcloud: "SoundCloud",
  "static-audio": "Audio file",
  youtube: "YouTube",
};

/**
 * Where a Track or File comes from and, in an album or playlist, which
 * track plays: "Bandcamp · Track 2 of 9".
 */
export function trackSubtitle(radio: Radio): string {
  const metadata = radio.platformMetadata;
  const label = PLATFORM_LABELS[metadata?.platform ?? ""] ?? "Track";
  if (!(metadata && isCollection(metadata) && "tracks" in metadata)) {
    return label;
  }
  const count = metadata.tracks?.length ?? 0;
  if (count === 0) {
    return label;
  }
  const index = getCurrentTrackIndex(metadata, radio.streamUrl);
  return `${label} · Track ${index + 1} of ${count}`;
}

/** A radio that ends: a platform track or a file, not a live stream. */
export function isTrackRadio(radio: RadioLike | null | undefined): boolean {
  return radio ? sourceTypeForRadio(radio) !== "station" : false;
}

export function isLocalFileRadio(radio: RadioLike | null | undefined): boolean {
  return localAudioUrls(radio as Radio | null).length > 0;
}

const pickedFileUrls = new Set<string>();
const soundFileReferences = new Map<string, number>();
let cleanupQueued = false;

/** Releases only this page's picked files once no graph or sound needs them. */
export function releaseUnusedLocalFileUrls(): void {
  const retained = new Set(soundFileReferences.keys());
  for (const graph of getRetainedNodeGraphs()) {
    for (const node of graph.nodes) {
      if (isRadioSourceNode(node) && node.data.radio) {
        for (const url of localAudioUrls(node.data.radio as Radio)) {
          retained.add(url);
        }
      }
    }
  }
  for (const url of pickedFileUrls) {
    if (!retained.has(url)) {
      URL.revokeObjectURL(url);
      pickedFileUrls.delete(url);
    }
  }
}

function scheduleFileCleanup(): void {
  if (cleanupQueued) {
    return;
  }
  cleanupQueued = true;
  queueMicrotask(() => {
    cleanupQueued = false;
    releaseUnusedLocalFileUrls();
  });
}

let observedNodeState = nodeStore.state;
nodeStore.subscribe((state) => {
  const previous = observedNodeState;
  observedNodeState = state;
  if (previous.graph !== state.graph || previous.history !== state.history) {
    scheduleFileCleanup();
  }
});

/** Keeps a sound's URL alive even while its graph is replaced and it fades. */
export function retainLocalFileUrl(url: string): () => void {
  if (!pickedFileUrls.has(url)) {
    return () => undefined;
  }
  soundFileReferences.set(url, (soundFileReferences.get(url) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (soundFileReferences.get(url) ?? 1) - 1;
    if (remaining > 0) {
      soundFileReferences.set(url, remaining);
    } else {
      soundFileReferences.delete(url);
    }
    scheduleFileCleanup();
  };
}

/** Keeps a picked file's object URL as playable for this page. */
export function keepLocalFileUrl(url: string): void {
  if (url.startsWith("blob:")) {
    pickedFileUrls.add(url);
  }
}

/**
 * Whether a local file's object URL died with an earlier page, so its File
 * must be picked again. Any other radio is never gone.
 */
export function isLocalFileGone(radio: RadioLike | null | undefined): boolean {
  return (
    isLocalFileRadio(radio) &&
    localAudioUrls(radio as Radio).some((url) => !pickedFileUrls.has(url))
  );
}

/** Forgets every picked file, as a reload does; for tests. */
export function forgetLocalFileUrls(): void {
  pickedFileUrls.clear();
  soundFileReferences.clear();
}

/** The radio a File plays for a picked file, shaped like a DJ deck's. */
export function localFileRadio(
  nodeId: string,
  metadata: FileAudioMetadata
): Radio {
  return {
    description: "Local File",
    enabled: true,
    id: `local-file-${nodeId}-${Date.now()}`,
    name: metadata.displayName,
    platformMetadata: {
      itemType: "track",
      platform: "local-file",
      url: "",
      ...metadata,
    },
    streamUrl: metadata.objectUrl,
  };
}
