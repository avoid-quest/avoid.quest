import { PlaylistURLPattern, TrackURLPattern } from "./validate";

/**
 * Formats a URL as a track's permalink URL
 */
export function getPermalinkURL(url: string): string {
  const result = url.match(TrackURLPattern);
  if (result) {
    const publicURL = `https://soundcloud.com/${result.groups!.user}/${result.groups!.title}`;
    return result.groups!.secret
      ? publicURL + `/${result.groups!.secret}`
      : publicURL;
  }
  return "";
}

/**
 * Formats a URL as a playlist's permalink URL
 */
export function getPlaylistPermalinkURL(url: string): string {
  const result = url.match(PlaylistURLPattern);
  if (result) {
    const publicURL = `https://soundcloud.com/${result.groups!.user}/sets/${result.groups!.title}`;
    return result.groups!.secret
      ? publicURL + `/${result.groups!.secret}`
      : publicURL;
  }
  return "";
}
