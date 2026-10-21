export type {
  PublicHostnameResolver as StreamHostnameResolver,
  PublicHttpUrlValidationFailure as StreamUrlValidationFailure,
  PublicHttpUrlValidationResult as StreamUrlValidationResult,
} from "@avoid.quest/platforms/url-policy";
export {
  isPublicHttpUrl,
  validatePublicHttpUrlParam as validatePublicStreamUrl,
  validateResolvedPublicHttpUrl as validateResolvedPublicStreamUrl,
} from "@avoid.quest/platforms/url-policy";
