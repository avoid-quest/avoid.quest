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
  const isDevelopment = process.env.NODE_ENV === "development";

  try {
    // Check if getCloudflareContext is available
    if (typeof getCloudflareContext !== "function") {
      if (isDevelopment) {
        console.warn("getCloudflareContext not available, allowing request");
        return { allowed: true };
      }
      console.error("getCloudflareContext not available in production");
      return { allowed: false };
    }

    const context = getCloudflareContext();
    if (!context?.env) {
      if (isDevelopment) {
        console.warn("Cloudflare context not available, allowing request");
        return { allowed: true };
      }
      console.error("Cloudflare context not available in production");
      return { allowed: false };
    }

    const rateLimit = context.env["proxy-rate-limit"];
    if (!rateLimit) {
      if (isDevelopment) {
        console.warn("Rate limit binding not available, allowing request");
        return { allowed: true };
      }
      console.error("Rate limit binding not available in production");
      return { allowed: false };
    }

    const key = `${identifier}:${sessionId}`;
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
