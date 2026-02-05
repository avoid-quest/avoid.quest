import type { YouTubeItemType } from "./types.js";

const YOUTUBE_PATTERN = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;

const VIDEO_ID_PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /\/shorts\/([a-zA-Z0-9_-]{11})/,
  /\/embed\/([a-zA-Z0-9_-]{11})/,
];

const PLAYLIST_ID_PATTERN = /[?&]list=([a-zA-Z0-9_-]+)/;

export function isYouTubeUrl(url: string): boolean {
  return Boolean(url) && YOUTUBE_PATTERN.test(url);
}

export function detectYouTubeItemType(url: string): YouTubeItemType {
  if (PLAYLIST_ID_PATTERN.test(url)) {
    return "playlist";
  }
  return "video";
}

export function extractVideoId(url: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function extractPlaylistId(url: string): string | null {
  const match = url.match(PLAYLIST_ID_PATTERN);
  return match?.[1] ?? null;
}
