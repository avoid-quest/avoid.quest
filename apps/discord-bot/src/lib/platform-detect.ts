import { detectPlatformFromUrl as detectExternalPlatform } from "@avoid.quest/platforms";
import { isStaticAudioUrl } from "@avoid.quest/platforms/static-audio";

export type Platform =
  | "bandcamp"
  | "radiogarden"
  | "soundcloud"
  | "youtube"
  | "static-audio";

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
