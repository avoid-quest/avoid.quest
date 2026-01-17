export type {
  BandcampItemType,
  BandcampMetadata,
  Platform,
  PlatformItemResponse,
  PlatformMetadata,
  SoundCloudItemType,
  SoundCloudMetadata,
} from "@/lib/platform-types";
export {
  detectBandcampItemType,
  detectPlatformFromUrl,
  detectSoundCloudItemType,
} from "./detect";
export {
  createPlatformRadio,
  formatPlatformDuration,
  getPlatformItemTypeLabel,
  isPlatformRadio,
  PlatformModeError,
  validateRadioForMode,
} from "./utils";
