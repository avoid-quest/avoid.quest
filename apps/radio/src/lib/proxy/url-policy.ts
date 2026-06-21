export type {
  PublicHttpUrlValidationFailure as StreamUrlValidationFailure,
  PublicHttpUrlValidationResult as StreamUrlValidationResult,
} from "@avoid.quest/platforms/url-policy";
export {
  isBlockedPublicHttpHostname as isBlockedStreamHostname,
  isPublicHttpUrl,
  validatePublicHttpUrlParam as validatePublicStreamUrl,
} from "@avoid.quest/platforms/url-policy";
