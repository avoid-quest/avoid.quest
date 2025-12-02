export type {
  BandcampItemType,
  BandcampMetadata,
  Platform,
  PlatformItemResponse,
  PlatformMetadata,
  SoundCloudItemType,
  SoundCloudMetadata,
} from "@avoid.quest/radio-shared";
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
} from "./utils";
