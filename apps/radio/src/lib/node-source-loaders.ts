/**
 * Node Source Loaders
 *
 * What fills a Station, Track or File from outside the patch, through the
 * loaders DJ decks use: a picked or pasted platform item (a `yt:` or
 * `spotify:track:` track resolved first), a local file read into an object URL, a static audio
 * URL (MP3, M3U, PLS) resolved in the browser, and a pasted radio stream
 * made a session station. Each returns the radio to put in the node, or
 * why it can't.
 */

import type { Radio } from "@/lib/audio";
import {
  extractFileMetadata,
  type FileAudioMetadata,
} from "@/lib/audio/file-metadata";
import {
  loadLocalAudioPlaylist,
  localAudioUrls,
} from "@/lib/audio/local-audio-playlist";
import { resolveDjPlatformStreamUrl } from "@/lib/dj-platform-stream-port";
import { keepLocalFileUrl, localFileRadio } from "@/lib/node-graph/sources";
import {
  type LoadPlatformItemResult,
  loadPlatformItem,
} from "@/lib/platform-item-loader";
import {
  type ResolvePlatformStream,
  radioOnTrack,
} from "@/lib/platform-stream-refresh";
import {
  type StationIntakeResult,
  stationIntake,
} from "@/lib/stations/external-station-workflow";

export type SourceLoad = { radio: Radio } | { error: string };

export type NodeSourceLoaderDependencies = {
  loadFile?: (file: File) => Promise<FileAudioMetadata>;
  loadItem?: (url: string) => Promise<LoadPlatformItemResult>;
  resolveStream?: ResolvePlatformStream;
  createSession?: (
    candidate: Parameters<typeof stationIntake.createSession>[0]
  ) => Promise<StationIntakeResult>;
};

const TRACK_UNPLAYABLE = "Couldn't play this track";

/** A picked or pasted item made playable: its lazy track resolved. */
export async function prepareSourceRadio(
  radio: Radio,
  {
    resolveStream = resolveDjPlatformStreamUrl,
  }: NodeSourceLoaderDependencies = {}
): Promise<SourceLoad> {
  if (radio.platformMetadata?.platform === "device-input") {
    return { radio };
  }
  try {
    const playable = await radioOnTrack(
      radio,
      radio.streamUrl,
      resolveStream,
      "initial-load"
    );
    return playable ? { radio: playable } : { error: TRACK_UNPLAYABLE };
  } catch {
    return { error: TRACK_UNPLAYABLE };
  }
}

/** A platform link or static audio URL, resolved as a DJ deck loads one. */
export async function loadSourceUrl(
  url: string,
  dependencies: NodeSourceLoaderDependencies = {}
): Promise<SourceLoad> {
  const result = await (dependencies.loadItem ?? loadPlatformItem)(url);
  return result.success
    ? await prepareSourceRadio(result.radio, dependencies)
    : { error: result.error };
}

/**
 * A local file for File `nodeId`. Its object URL is kept as playable for
 * this page only; after a reload the File asks for the file again.
 */
export async function loadLocalFile(
  nodeId: string,
  file: File,
  { loadFile = extractFileMetadata }: NodeSourceLoaderDependencies = {}
): Promise<SourceLoad> {
  try {
    const metadata = await loadFile(file);
    keepLocalFileUrl(metadata.objectUrl);
    return { radio: localFileRadio(nodeId, metadata) };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to load audio file",
    };
  }
}

function streamName(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * A radio stream URL pasted into a Station, made a session station as a
 * URL added in Settings would be, under its host's name.
 */
export async function loadStreamStation(
  url: string,
  {
    createSession = (candidate) => stationIntake.createSession(candidate),
  }: NodeSourceLoaderDependencies = {}
): Promise<SourceLoad> {
  const result = await createSession({
    fields: { name: streamName(url), streamUrl: url },
    origin: "manual",
  });
  if (!result.ok) {
    return { error: result.error.message };
  }
  const { radio } = result.data;
  // The session record is keyed by name when the radio has no id.
  return { radio: { ...radio, id: radio.id ?? radio.name } };
}

export async function loadLocalFiles(
  files: readonly File[],
  { loadFile = extractFileMetadata }: NodeSourceLoaderDependencies = {}
): Promise<SourceLoad> {
  try {
    const radio = await loadLocalAudioPlaylist(files, loadFile);
    for (const url of localAudioUrls(radio)) {
      keepLocalFileUrl(url);
    }
    return { radio };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to load folder",
    };
  }
}
