import { getCloudflareContext } from "@opennextjs/cloudflare";

export type RateLimitResult = {
  allowed: boolean;
};

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
  try {
    const { env } = getCloudflareContext();
    const rateLimit = env["proxy-rate-limit"];

    if (!rateLimit) {
      // In development, allow the request if binding is not available
      // In production, fail closed for security
      const isDevelopment = process.env.NODE_ENV === "development";
      if (isDevelopment) {
        return { allowed: true };
      }
      console.error("Rate limit binding not available in production");
      return { allowed: false };
    }

    const key = `${identifier}:${sessionId}`;
    const outcome = await rateLimit.limit({ key });

    return { allowed: outcome.success };
  } catch (error) {
    // Fail closed on error for security
    console.error("Rate limit check failed:", error);
    return { allowed: false };
  }
}
