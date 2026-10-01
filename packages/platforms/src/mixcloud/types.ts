import type { PlatformStreamFormat } from "../stream-format.js";

/** Only shows ("cloudcasts") are playable; profiles and lists are not. */
export type MixcloudItemType = "show";

export type MixcloudStreamProtocol = PlatformStreamFormat;

export type MixcloudMetadata = {
  platform: "mixcloud";
  itemType: MixcloudItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  streamUrl?: string;
};

export type MixcloudItemResult = {
  format: PlatformStreamFormat;
  success: true;
  metadata: MixcloudMetadata;
  streamUrl: string;
};

export type MixcloudItemError = {
  success: false;
  error: string;
};

export type MixcloudItemResponse = MixcloudItemResult | MixcloudItemError;
