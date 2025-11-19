import type {
  DataWrapped,
  PartialTrackInfo,
  StreamableTrackInfoData,
  TrackInfoData,
  UserInfo,
} from "../info";
import { streamPlaylistFromInfo } from "../stream";
import type { Transcoding } from "./transcoding";
import { fetchPartialPlaylist, isPlaylistFetched } from "./partial";

export class PlaylistInfo<fetched extends boolean = boolean> {
  constructor(public readonly data: PlaylistInfoData<fetched>) {}

  /**
   * Checks if all track data has been fetched
   */
  isFetched(): this is PlaylistInfo<true> {
    return isPlaylistFetched(this);
  }

  /**
   * Fetches any partial track data in this playlist
   */
  async fetchPartialTracks(): Promise<PlaylistInfo<true>> {
    await fetchPartialPlaylist(this);
    return this as PlaylistInfo<true>;
  }

  /**
   * Stream tracks from this playlist
   *
   * Fetches partial track data first
   */
  async stream(): Promise<Array<{ transcoding: Transcoding; streamUrl: string } | null>> {
    return streamPlaylistFromInfo(this);
  }
}

export type PlaylistInfoData<fetched extends boolean = boolean> = {
  artwork_url?: string;
  created_at: string;
  description?: string;
  duration: number;
  embeddable_by: string;
  genre?: string;
  id: number;
  kind: string;
  label_name?: string;
  last_modified: string;
  license: string;
  likes_count: number;
  managed_by_feeds: boolean;
  permalink: string;
  permalink_url: string;
  public: boolean;
  purchase_title?: string;
  purchase_url?: string;
  release_date?: string;
  reposts_count: number;
  secret_token?: string;
  sharing: string;
  tag_list?: string;
  title: string;
  uri: string;
  user_id: number;
  set_type?: string;
  is_album: boolean;
  published_at?: string;
  display_date: string;
  user: UserInfo;
  tracks: fetched extends true
    ? Array<TrackInfoData>
    : Array<TrackInfoData | PartialTrackInfo>;
  track_count: number;
};

export type StreamablePlaylistInfoData = {
  tracks: Array<StreamableTrackInfoData>;
};

export type StreamablePlaylistInfo = DataWrapped<StreamablePlaylistInfoData>;
