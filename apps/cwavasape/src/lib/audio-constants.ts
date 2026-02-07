export const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export const SAFE_KEY_PATTERN = /^[\w\-./]+\.(mp3|wav|ogg)$/;
