export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type UrlValidationResult<Failure extends string> =
  | { ok: true; url: string }
  | { ok: false; reason: Failure };

export type ValidatedRedirectFailure<Failure extends string> =
  | Failure
  | "missing-location"
  | "too-many-redirects";

export type RedirectTargetValidationFailure<Failure extends string> = Exclude<
  Failure,
  "required"
>;

export type ValidatedRedirectTargetFailure<Failure extends string> =
  ValidatedRedirectFailure<RedirectTargetValidationFailure<Failure>>;

export type ValidatedRedirectSuccess = {
  response: Response;
  resolvedUrl: string;
};

export type ValidatedRedirectFailureDetails<Failure extends string> = {
  reason: ValidatedRedirectFailure<Failure>;
  url: string;
};

export type ValidatedRedirectResult<Failure extends string> =
  | ({ ok: true } & ValidatedRedirectSuccess)
  | { failure: ValidatedRedirectFailureDetails<Failure>; ok: false };

export class ValidatedRedirectError<
  Reason extends string = string,
> extends Error {
  readonly reason: Reason;
  readonly url: string;

  constructor(reason: Reason, url: string) {
    super(`Redirect rejected: ${reason}`);
    this.name = "ValidatedRedirectError";
    this.reason = reason;
    this.url = url;
  }
}

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchWithValidatedRedirectsOptions<Failure extends string> = {
  fetchImpl: FetchLike;
  init?: RequestInit;
  invalidUrlReason: Failure;
  maxRedirects?: number;
  url: string;
  validateUrl: (url: string) => UrlValidationResult<Failure>;
};

type UrlValidator<UrlFailure extends string> = (
  urlParam: string | null
) => UrlValidationResult<UrlFailure>;

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // Some runtimes lock the body stream once headers are available.
  }
}

function redirectFailure<Failure extends string>(
  reason: ValidatedRedirectFailure<Failure>,
  url: string
): ValidatedRedirectResult<Failure> {
  return { failure: { reason, url }, ok: false };
}

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

export async function fetchWithValidatedRedirectResult<Failure extends string>({
  fetchImpl,
  init,
  invalidUrlReason,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  url,
  validateUrl,
}: FetchWithValidatedRedirectsOptions<Failure>): Promise<
  ValidatedRedirectResult<Failure>
> {
  const initialValidation = validateUrl(url);
  if (!initialValidation.ok) {
    return redirectFailure<Failure>(initialValidation.reason, url);
  }

  let currentUrl = initialValidation.url;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      ...init,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return { ok: true, response, resolvedUrl: currentUrl };
    }

    await cancelResponseBody(response);

    if (redirectCount >= maxRedirects) {
      return redirectFailure<Failure>("too-many-redirects", currentUrl);
    }

    const location = response.headers.get("Location");
    if (!location) {
      return redirectFailure<Failure>("missing-location", currentUrl);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      return redirectFailure<Failure>(invalidUrlReason, location);
    }

    const validation = validateUrl(nextUrl);
    if (!validation.ok) {
      return redirectFailure<Failure>(validation.reason, nextUrl);
    }

    currentUrl = validation.url;
  }
}

export async function fetchWithValidatedRedirects<Failure extends string>(
  options: FetchWithValidatedRedirectsOptions<Failure>
): Promise<ValidatedRedirectSuccess> {
  const result = await fetchWithValidatedRedirectResult(options);
  if (!result.ok) {
    throw new ValidatedRedirectError(result.failure.reason, result.failure.url);
  }

  return {
    response: result.response,
    resolvedUrl: result.resolvedUrl,
  };
}
