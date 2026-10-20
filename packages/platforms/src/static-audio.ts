import { isStaticAudioUrl } from "./static-audio/detect.js";
import {
  type PublicHostnameResolver,
  type PublicHttpUrlFailure,
  type PublicHttpUrlResult,
  validateResolvedPublicHttpUrl,
} from "./url-policy/index.js";

export {
  AUDIO_EXTENSIONS,
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
  PLAYLIST_EXTENSIONS,
} from "./static-audio/detect.js";

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

export function validatePublicStaticAudioUrl(
  url: string,
  options: ValidatePublicStaticAudioUrlOptions = {}
): Promise<PublicStaticAudioUrlResult> {
  if (!isStaticAudioUrl(url)) {
    return Promise.resolve({ ok: false, reason: "unsupported-url" });
  }

  return validateResolvedPublicHttpUrl(url, options);
}
