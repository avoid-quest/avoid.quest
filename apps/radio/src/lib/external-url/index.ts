export {
  detectBandcampItemType,
  detectPlatformFromUrl,
  detectSoundCloudItemType,
} from "./detect";
export type {
  BandcampItemType,
  BandcampMetadata,
  Platform,
  PlatformItemResponse,
  PlatformMetadata,
  SoundCloudItemType,
  SoundCloudMetadata,
} from "./types";
export {
  createPlatformRadio,
  formatPlatformDuration,
  getPlatformItemTypeLabel,
  isPlatformRadio,
} from "./utils";
