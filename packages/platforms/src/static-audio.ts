import {
  type PublicHostnameResolver,
  type PublicHttpUrlFailure,
  type PublicHttpUrlResult,
  validateResolvedPublicHttpUrl,
} from "./url-policy/index.js";

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

export type PublicStaticAudioUrlFailure =
  | PublicHttpUrlFailure
  | "unsupported-url";

export type PublicStaticAudioUrlResult =
  | PublicHttpUrlResult
  | { ok: false; reason: "unsupported-url" };

type ValidatePublicStaticAudioUrlOptions = {
  resolveHostname?: PublicHostnameResolver | false;
  signal?: AbortSignal;
};

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

export function isAudioUrl(url: string): boolean {
  const ext = getExtension(url);
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function isPlaylistUrl(url: string): boolean {
  const ext = getExtension(url);
  return (PLAYLIST_EXTENSIONS as readonly string[]).includes(ext);
}

export function isStaticAudioUrl(url: string): boolean {
  return isAudioUrl(url) || isPlaylistUrl(url);
}

export function validatePublicStaticAudioUrl(
  url: string,
  options: ValidatePublicStaticAudioUrlOptions = {}
): Promise<PublicStaticAudioUrlResult> {
  if (!isStaticAudioUrl(url)) {
    return Promise.resolve({ ok: false, reason: "unsupported-url" });
  }

  return validateResolvedPublicHttpUrl(url, options);
}

export function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const { pathname } = parsed;
    const lastSlash = pathname.lastIndexOf("/");
    const filename =
      lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);
    const lastDot = filename.lastIndexOf(".");
    const name = lastDot === -1 ? filename : filename.slice(0, lastDot);
    return decodeURIComponent(name).replace(/[_-]+/g, " ").trim();
  } catch {
    return "Unknown";
  }
}
