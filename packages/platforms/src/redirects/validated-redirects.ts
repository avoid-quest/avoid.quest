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

export async function fetchWithValidatedRedirects<Failure extends string>({
  fetchImpl,
  init,
  invalidUrlReason,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  url,
  validateUrl,
}: {
  fetchImpl: FetchLike;
  init?: RequestInit;
  invalidUrlReason: Failure;
  maxRedirects?: number;
  url: string;
  validateUrl: (url: string) => UrlValidationResult<Failure>;
}): Promise<{ response: Response; resolvedUrl: string }> {
  const initialValidation = validateUrl(url);
  if (!initialValidation.ok) {
    throw new ValidatedRedirectError(initialValidation.reason, url);
  }

  let currentUrl = initialValidation.url;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      ...init,
      redirect: "manual",
    });

    if (!isRedirectStatus(response.status)) {
      return { response, resolvedUrl: currentUrl };
    }

    await cancelResponseBody(response);

    if (redirectCount >= maxRedirects) {
      throw new ValidatedRedirectError("too-many-redirects", currentUrl);
    }

    const location = response.headers.get("Location");
    if (!location) {
      throw new ValidatedRedirectError("missing-location", currentUrl);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new ValidatedRedirectError(invalidUrlReason, location);
    }

    const validation = validateUrl(nextUrl);
    if (!validation.ok) {
      throw new ValidatedRedirectError(validation.reason, nextUrl);
    }

    currentUrl = validation.url;
  }
}
