import type {
  RedirectTargetValidationFailure,
  UrlValidationResult,
} from "@avoid.quest/platforms/redirects";

type UrlValidator<UrlFailure extends string> = (
  urlParam: string | null
) => UrlValidationResult<UrlFailure>;

export function validateRedirectTargetUrl<UrlFailure extends string>(
  url: string,
  validateUrl: UrlValidator<UrlFailure>,
  invalidUrlReason: RedirectTargetValidationFailure<UrlFailure>
): UrlValidationResult<RedirectTargetValidationFailure<UrlFailure>> {
  const validation = validateUrl(url);
  if (validation.ok) {
    return validation;
  }

  if (validation.reason === "required") {
    return { ok: false, reason: invalidUrlReason };
  }

  return {
    ok: false,
    reason: validation.reason as RedirectTargetValidationFailure<UrlFailure>,
  };
}
