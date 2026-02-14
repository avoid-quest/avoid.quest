export type RadioGardenMetadata = {
  platform: "radiogarden";
  itemType: "channel";
  url: string;
  channelId: string;
  name?: string;
  subtitle?: string;
  website?: string;
  placeId?: string;
  placeTitle?: string;
  countryTitle?: string;
};

export type RadioGardenSearchResult = {
  channelId: string;
  title: string;
  subtitle: string;
  url: string;
  website?: string;
  placeTitle: string;
  countryTitle: string;
};

export type RadioGardenItemResult = {
  success: true;
  metadata: RadioGardenMetadata;
  streamUrl: string;
};

export type RadioGardenItemError = {
  success: false;
  error: string;
};

export type RadioGardenItemResponse =
  | RadioGardenItemResult
  | RadioGardenItemError;
