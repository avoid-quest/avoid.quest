/**
 * A regular expression that matches SoundCloud track URLs
 *
 * Includes the `user`, `title`, and `secret` groups
 */
export const TrackURLPattern =
  /^(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/(?<user>[\w-]+)\/(?!sets(?:$|[/?#]))(?<title>[\w-]+)\/?(?<secret>(?<=\/)s-[A-Z0-9]+)?(?:(?<!\/)\/?)(?=[?#]|$)/i;

/**
 * A regular expression that matches SoundCloud playlist URLs
 *
 * Includes the `user`, `title`, and `secret` groups
 */
export const PlaylistURLPattern =
  /^(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/(?<user>[\w-]+)\/sets\/(?<title>[\w-]+)\/?(?<secret>(?<=\/)s-[A-Z0-9]+)?(?:(?<!\/)\/?)(?=[?#]|$)/i;

/**
 * Checks if a string matches the SoundCloud track URL format
 */
export function validateURL(url: string): boolean {
  return TrackURLPattern.test(url);
}

/**
 * Checks if a string matches the SoundCloud playlist URL format
 */
export function validatePlaylistURL(url: string): boolean {
  return PlaylistURLPattern.test(url);
}
