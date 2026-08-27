export type RateLimitResult = {
  allowed: boolean;
};

export type RateLimitEnv = {
  "proxy-rate-limit"?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
};

export type RateLimitSubject = { type: "ip"; value: string };

function getNonEmptyHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim();
  return value || undefined;
}

function getForwardedClientIP(request: Request): string | undefined {
  const forwardedFor = getNonEmptyHeader(request.headers, "x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || undefined;
}

export function getCloudflareClientIP(request: Request): string | undefined {
  return getNonEmptyHeader(request.headers, "cf-connecting-ip");
}

export function getClientIP(request: Request): string | undefined {
  return getCloudflareClientIP(request) || getForwardedClientIP(request);
}

export function resolveRateLimitSubject(
  request: Request
): RateLimitSubject | null {
  const cfClientIP = getCloudflareClientIP(request);
  if (cfClientIP) {
    return { type: "ip", value: cfClientIP };
  }

  return null;
}

function formatRateLimitKey(
  identifier: string,
  subject: RateLimitSubject
): string {
  return `${identifier}:${subject.type}:${subject.value}`;
}

/**
 * Check rate limit using Cloudflare Rate Limit API
 * @param env - The Cloudflare environment bindings
 * @param identifier - Unique identifier for this rate limit (e.g., 'radio-metadata')
 * @param subject - Trusted subject to rate limit against
 * @returns Rate limit result with allowed status
 */
export async function checkRateLimit(
  env: RateLimitEnv | undefined,
  identifier: string,
  subject: RateLimitSubject | null
): Promise<RateLimitResult> {
  const isDevelopment = process.env.NODE_ENV === "development";

  try {
    if (!subject) {
      if (isDevelopment) {
        console.warn("Rate limit key not available, allowing request");
        return { allowed: true };
      }
      console.error("Rate limit key not available in production");
      return { allowed: false };
    }

    if (!env) {
      if (isDevelopment) {
        console.warn("Environment not available, allowing request");
        return { allowed: true };
      }
      console.error("Environment not available in production");
      return { allowed: false };
    }

    const rateLimit = env["proxy-rate-limit"];
    if (!rateLimit) {
      if (isDevelopment) {
        console.warn("Rate limit binding not available, allowing request");
        return { allowed: true };
      }
      console.error("Rate limit binding not available in production");
      return { allowed: false };
    }

    const key = formatRateLimitKey(identifier, subject);
    const outcome = await rateLimit.limit({ key });

    return { allowed: outcome.success };
  } catch (error) {
    // In development, allow on error to avoid blocking development
    // In production, fail closed for security
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Rate limit check failed:", errorMessage, error);

    if (isDevelopment) {
      console.warn("Allowing request due to rate limit error in development");
      return { allowed: true };
    }

    return { allowed: false };
  }
}
