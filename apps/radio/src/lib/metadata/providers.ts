import {
  type ExternalMetadataProviderAdapter,
  tryAirtimeLiveInfo,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
} from "./external-providers";

export const EXTERNAL_METADATA_PROVIDER_ADAPTERS: ExternalMetadataProviderAdapter[] =
  [
    { id: "nts-live-api", retrieve: tryNtsLiveApi },
    { id: "radio-blackout-api", retrieve: tryRadioBlackoutApi },
    { id: "airtime-live-info", retrieve: tryAirtimeLiveInfo },
  ];
