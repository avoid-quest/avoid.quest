/**
 * File Audio Metadata Utilities
 *
 * Validates audio files and extracts metadata (duration, display name)
 * using a temporary HTMLAudioElement and object URLs.
 */

export type FileAudioMetadata = {
  fileName: string;
  displayName: string;
  duration: number;
  fileSize: number;
  mimeType: string;
  objectUrl: string;
};

export const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/vorbis",
  "audio/flac",
  "audio/x-flac",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "audio/opus",
]);

export const ACCEPTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".m4a",
  ".webm",
  ".opus",
  ".wma",
]);

/**
 * Check if a file is a supported audio file by MIME type or extension fallback.
 */
export function isAudioFile(file: File): boolean {
  if (ACCEPTED_AUDIO_TYPES.has(file.type)) {
    return true;
  }
  // Fallback to extension check when MIME type is empty or generic
  const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
  return ACCEPTED_AUDIO_EXTENSIONS.has(ext);
}

const FILE_EXTENSION_RE = /\.[^.]+$/;
const SEPARATOR_RE = /[_-]+/g;

/**
 * Strip file extension and clean up the filename for display.
 */
function getDisplayName(fileName: string): string {
  return fileName
    .replace(FILE_EXTENSION_RE, "")
    .replace(SEPARATOR_RE, " ")
    .trim();
}

/**
 * Create an object URL and probe duration via a temporary <audio> element.
 */
export function extractFileMetadata(file: File): Promise<FileAudioMetadata> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio();

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };

    const onLoaded = () => {
      cleanup();
      resolve({
        fileName: file.name,
        displayName: getDisplayName(file.name),
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        fileSize: file.size,
        mimeType: file.type || "audio/unknown",
        objectUrl,
      });
    };

    const onError = () => {
      cleanup();
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load audio file: ${file.name}`));
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.preload = "metadata";
    audio.src = objectUrl;
  });
}

/**
 * Safely revoke an object URL (no-op if not a blob URL).
 */
export function revokeFileObjectUrl(url: string): void {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
