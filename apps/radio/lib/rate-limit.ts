// RateLimit type is defined in cloudflare-env.d.ts
type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining?: number;
};

export type RateLimitOptions = {
  limit: number;
  window: number;
};

/**
 * Check rate limit using Cloudflare Rate Limit API
 * @param rateLimit - The rate limit binding from Cloudflare environment
 * @param sessionId - The session ID to rate limit against
 * @param identifier - Unique identifier for this rate limit (e.g., 'soundcloud-proxy')
 * @param _options - Rate limit options (for documentation, actual limits are configured in wrangler.jsonc)
 * @returns Rate limit result with allowed status and remaining requests
 */
export async function checkRateLimit(
  rateLimit: RateLimit | undefined,
  sessionId: string,
  identifier: string,
  _options: RateLimitOptions
): Promise<RateLimitResult> {
  // If rate limit binding is not available (e.g., in development), allow the request
  if (!rateLimit) {
    return { allowed: true };
  }

  try {
    const key = `${identifier}:${sessionId}`;
    const outcome = await rateLimit.limit({ key });

    // Cloudflare Rate Limit API returns success: true if within limit
    // We need to check the actual implementation - typically it returns
    // success: false when rate limited, but we'll be defensive
    if (!outcome.success) {
      return { allowed: false };
    }

    // Note: Cloudflare Rate Limit API doesn't expose remaining count
    // We return allowed: true when within limits
    return { allowed: true };
  } catch (error) {
    // On error, log but allow the request (fail open for availability)
    console.error("Rate limit check failed:", error);
    return { allowed: true };
  }
}
