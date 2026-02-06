/**
 * Remote URL Detection Utilities
 *
 * Detects audio files and playlists from HTTP URLs based on extension.
 */

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".webm",
  ".opus",
] as const;

export const PLAYLIST_EXTENSIONS = [".m3u", ".m3u8", ".pls"] as const;

/**
 * Get the file extension from a URL (without query string)
 */
function getExtension(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1) {
      return "";
    }
    return pathname.slice(lastDot);
  } catch {
    return "";
  }
}

/**
 * Check if a URL points to an audio file
 */
export function isAudioUrl(url: string): boolean {
  const ext = getExtension(url);
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Check if a URL points to a playlist file
 */
export function isPlaylistUrl(url: string): boolean {
  const ext = getExtension(url);
  return (PLAYLIST_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Check if a URL points to an audio file or playlist
 */
export function isStaticAudioUrl(url: string): boolean {
  return isAudioUrl(url) || isPlaylistUrl(url);
}

/**
 * Extract filename from a URL (without extension, cleaned up for display)
 */
export function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastSlash = pathname.lastIndexOf("/");
    const filename =
      lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);

    // Remove extension
    const lastDot = filename.lastIndexOf(".");
    const name = lastDot === -1 ? filename : filename.slice(0, lastDot);

    // Decode URI components and clean up
    return decodeURIComponent(name).replace(/[_-]+/g, " ").trim();
  } catch {
    return "Unknown";
  }
}
