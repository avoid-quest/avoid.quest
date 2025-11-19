import { rawResolve } from "../api";
import type { DataWrapped, TrackInfoData } from "../info";
import type { StreamablePlaylistInfo } from "./playlist";

/**
 * Checks if all track data in a playlist has been fetched
 */
export function isPlaylistFetched(
  info: FetchablePlaylistInfo
): info is StreamablePlaylistInfo & FetchablePlaylistInfo {
  return info.data.tracks.every((track) => "media" in track);
}

/**
 * Creates a track URI from a track's id
 * @param id The track's id
 */
function trackURI(id: number): string {
  return `https://api.soundcloud.com/tracks/${id}`;
}

/**
 * Fetches any partial track data in a playlist's info object
 *
 * Track info is updated in place
 * @param info Info obtained from `getPlaylistInfo`
 * @returns The updated playlist info object
 */
export async function fetchPartialPlaylist(
  info: FetchablePlaylistInfo
): Promise<StreamablePlaylistInfo> {
  info.data.tracks = await Promise.all(
    info.data.tracks.map(async (track) => {
      if ("media" in track) {
        return track;
      }
      const info = (await rawResolve(trackURI(track.id))) as TrackInfoData;
      return info;
    })
  );
  return info as StreamablePlaylistInfo;
}

export type MinimalTrackInfo = {
  id: number;
};

export type FetchablePlaylistInfoData = {
  tracks: Array<TrackInfoData | MinimalTrackInfo>;
};

export type FetchablePlaylistInfo = DataWrapped<FetchablePlaylistInfoData>;
