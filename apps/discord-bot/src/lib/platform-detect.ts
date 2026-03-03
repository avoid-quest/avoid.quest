import { detectPlatformFromUrl as detectExternalPlatform } from "@avoid.quest/platforms";

export type Platform =
  | "bandcamp"
  | "radiogarden"
  | "soundcloud"
  | "youtube"
  | "static-audio";

const AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".webm",
  ".opus",
];

const PLAYLIST_EXTENSIONS = [".m3u", ".m3u8", ".pls"];

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

function isStaticAudioUrl(url: string): boolean {
  const ext = getExtension(url);
  return AUDIO_EXTENSIONS.includes(ext) || PLAYLIST_EXTENSIONS.includes(ext);
}

export function detectPlatformFromUrl(url: string): Platform | null {
  const external = detectExternalPlatform(url);
  if (external) {
    return external;
  }
  if (url && isStaticAudioUrl(url)) {
    return "static-audio";
  }
  return null;
}
