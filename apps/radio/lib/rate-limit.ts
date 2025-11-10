// RateLimit type is defined in cloudflare-env.d.ts
type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining?: number;
};

/**
 * Get the Cloudflare rate limit binding from the environment.
 * In Cloudflare Workers, bindings are available via process.env with the exact binding name.
 * @returns The rate limit binding or undefined if not available
 */
export function getRateLimitBinding(): RateLimit | undefined {
  // Access the binding using the exact name from wrangler.jsonc: "proxy-rate-limit"
  // In Cloudflare Workers, hyphenated binding names are accessible via process.env
  const binding = (
    process.env as unknown as { "proxy-rate-limit"?: RateLimit }
  )["proxy-rate-limit"];
  return binding;
}

/**
 * Check rate limit using Cloudflare Rate Limit API
 * @param sessionId - The session ID to rate limit against
 * @param identifier - Unique identifier for this rate limit (e.g., 'soundcloud-proxy')
 * @returns Rate limit result with allowed status
 */
export async function checkRateLimit(
  sessionId: string,
  identifier: string
): Promise<RateLimitResult> {
  const rateLimit = getRateLimitBinding();

  // In development, if rate limit binding is not available, allow the request
  // In production, fail closed for security
  const isDevelopment = process.env.NODE_ENV === "development";
  if (!rateLimit) {
    if (isDevelopment) {
      return { allowed: true };
    }
    // Fail closed in production if binding is missing
    console.error("Rate limit binding not available in production");
    return { allowed: false };
  }

  try {
    const key = `${identifier}:${sessionId}`;
    const outcome = await rateLimit.limit({ key });

    // Cloudflare Rate Limit API returns success: true if within limit
    if (!outcome.success) {
      return { allowed: false };
    }

    // Note: Cloudflare Rate Limit API doesn't expose remaining count
    return { allowed: true };
  } catch (error) {
    // Fail closed on error for security
    console.error("Rate limit check failed:", error);
    return { allowed: false };
  }
}
