/** biome-ignore-all lint/suspicious/useAwait: original lib */
import { requestWithAuth } from "./dispatch";
import {
  getInfo,
  getPlaylistInfo,
  type StreamableTrackInfo,
  type StreamableTrackInfoData,
} from "./info";
import { ScdlError } from "./utils/error";
import {
  type FetchablePlaylistInfo,
  fetchPartialPlaylist,
} from "./utils/partial";
import type { StreamablePlaylistInfo } from "./utils/playlist";
import {
  MimeType,
  Preset,
  Protocol,
  Quality,
  type Transcoding,
} from "./utils/transcoding";

const DEFAULT_OPTIONS: StreamOptions = {
  strict: false,
  preset: Preset.MP3,
  protocol: Protocol.PROGRESSIVE,
  mimeType: MimeType.MPEG,
  quality: Quality.SQ,
};

const OPTION_WEIGHT: Record<keyof TranscodingOptions, number> = {
  mimeType: 1,
  preset: 1.1,
  protocol: 1.2,
  quality: 1.3,
};

/**
 * Resolve transcoding URL from a transcoding object
 * @param transcoding The transcoding to resolve
 * @returns The resolved stream URL
 */
async function resolveTranscodingUrl(
  transcoding: Transcoding
): Promise<string> {
  const { url: streamUrl }: TranscodingStreamResponse = await requestWithAuth(
    transcoding.url
  );
  return streamUrl;
}

/**
 * Find a transcoding that matches the given options
 * @param transcodings Transcodings obtained from a track's info
 * @param options Transcoding search options
 */
function findTranscoding(
  transcodings: Array<Transcoding>,
  options: StreamOptions
): Transcoding | null {
  if (!transcodings.length) {
    return null;
  }
  if (options.strict) {
    return (
      transcodings.find(
        (transcoding) =>
          (!options.preset || transcoding.preset === options.preset) &&
          (!options.protocol ||
            transcoding.format.protocol === options.protocol) &&
          (!options.mimeType ||
            transcoding.format.mime_type === options.mimeType) &&
          (!options.quality || transcoding.quality === options.quality)
      ) ?? null
    );
  }
  const { transcoding: best } = transcodings.reduce(
    (currentBest: ScoredTranscoding, transcoding) => {
      const data: TranscodingOptions = {
        preset: transcoding.preset,
        protocol: transcoding.format.protocol,
        mimeType: transcoding.format.mime_type,
        quality: transcoding.quality,
      };
      const current: ScoredTranscoding = {
        transcoding,
        score: Object.keys(OPTION_WEIGHT).reduce((score, key) => {
          if (
            data[<keyof TranscodingOptions>key] ===
            options[<keyof TranscodingOptions>key]
          ) {
            score += OPTION_WEIGHT[<keyof TranscodingOptions>key];
          }
          return score;
        }, 0),
      };
      return current.score > currentBest.score ? current : currentBest;
    },
    {
      transcoding: null,
      score: 0,
    }
  );
  return best ?? transcodings[0];
}

/**
 * Underlying transcoding resolution
 *
 * Not exportable
 * @param info Info obtained from `getInfo`
 * @param options Transcoding search options
 */
async function streamEngine(
  info: StreamableTrackInfoData,
  options: StreamOptions
): Promise<{ transcoding: Transcoding; streamUrl: string }> {
  if (info.streamable === false) {
    throw new ScdlError("Track not streamable");
  }
  const transcoding = findTranscoding(info.media.transcodings, options);
  if (transcoding) {
    const streamUrl = await resolveTranscodingUrl(transcoding);
    return { transcoding, streamUrl };
  }
  throw new ScdlError("Failed to obtain transcoding");
}

/**
 * Stream a track from its info object
 *
 * Used internally by `stream`
 * @param info Info obtained from `getInfo`
 * @param options Transcoding search options
 */
export async function streamFromInfo(
  info: StreamableTrackInfo,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<{ transcoding: Transcoding; streamUrl: string }> {
  return streamEngine(info.data, options);
}

/**
 * Stream a track from its URL
 * 
 * Returns an object with transcoding information and resolved stream URL.
 * For Cloudflare Workers compatibility, this does not return actual streams.
 * @param url A track URL
 * @param options Transcoding search options
 */
export async function stream(
  url: string,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<{ transcoding: Transcoding; streamUrl: string }> {
  const info = await getInfo(url);
  return streamFromInfo(info, options);
}

/**
 * Synchronously stream a track from its URL
 * 
 * Note: This is a stub for backward compatibility. Returns a promise-based result.
 * @param url A track URL
 * @param options Transcoding search options
 */
export function streamSync(
  url: string,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<{ transcoding: Transcoding; streamUrl: string }> {
  return getInfo(url).then((info) => streamEngine(info.data, options));
}

/**
 * Synchronously stream a track from its info object
 * 
 * Note: This is a stub for backward compatibility. Returns a promise-based result.
 * @param info Info obtained from `getInfo`
 * @param options Transcoding search options
 */
export function streamFromInfoSync(
  info: StreamableTrackInfo,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<{ transcoding: Transcoding; streamUrl: string }> {
  return streamEngine(info.data, options);
}

/**
 * Stream tracks from a playlist's info object
 *
 * Fetches partial track data before streaming
 *
 * Used internally by `streamPlaylist` and `PlaylistInfo.stream`
 * @param info Info obtained from `getPlaylistInfo`
 * @param options Transcoding search options
 * @returns A promise that resolves in an array. Each item will be either a result object or `null` if streaming errored
 */
export async function streamPlaylistFromInfo(
  info: StreamablePlaylistInfo | FetchablePlaylistInfo,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<Array<{ transcoding: Transcoding; streamUrl: string } | null>> {
  await fetchPartialPlaylist(info as FetchablePlaylistInfo);
  return Promise.all(
    info.data.tracks.map(async (track) => {
      try {
        return await streamEngine(track as StreamableTrackInfoData, options);
      } catch {
        return null;
      }
    })
  );
}

/**
 * Stream tracks from a playlist's URL
 * @param url A playlist URL
 * @param options Transcoding search options
 * @returns A promise that resolves in an array. Each item will be either a result object or `null` if streaming errored
 */
export async function streamPlaylist(
  url: string,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<Array<{ transcoding: Transcoding; streamUrl: string } | null>> {
  const info = await getPlaylistInfo(url);
  return streamPlaylistFromInfo(info, options);
}

/**
 * Synchronously stream tracks from a playlist's info object
 * 
 * Note: This is a stub for backward compatibility. Returns promise-based results.
 * @param info Info obtained from `getPlaylistInfo`
 * @param options Transcoding search options
 */
export function streamPlaylistFromInfoSync(
  info: StreamablePlaylistInfo,
  options: StreamOptions = DEFAULT_OPTIONS
): Promise<Array<{ transcoding: Transcoding; streamUrl: string } | null>> {
  return Promise.all(
    info.data.tracks.map(async (track) => {
      try {
        return await streamEngine(track, options);
      } catch {
        return null;
      }
    })
  );
}

type TranscodingOptions = {
  preset: Preset;
  protocol: Protocol;
  mimeType: MimeType;
  quality: Quality;
};

export type StreamOptions = Partial<TranscodingOptions> & {
  /**
   * If `true`, will only stream if all specified options match a transcoding
   *
   * If `false`, will stream most similar transcoding
   *
   * Defaults to `false`
   */
  strict?: boolean;
};

type ScoredTranscoding = {
  transcoding: Transcoding | null;
  score: number;
};

type TranscodingStreamResponse = {
  url: string;
};
