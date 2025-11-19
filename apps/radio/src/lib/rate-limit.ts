export type RateLimitResult = {
  allowed: boolean;
};

/**
 * Check rate limit using Cloudflare Rate Limit API
 * @param env - The Cloudflare environment bindings
 * @param sessionId - The session ID to rate limit against
 * @param identifier - Unique identifier for this rate limit (e.g., 'soundcloud-proxy')
 * @returns Rate limit result with allowed status
 */
export async function checkRateLimit(
  env: {
    "proxy-rate-limit"?: {
      limit: (options: { key: string }) => Promise<{ success: boolean }>;
    };
  },
  sessionId: string,
  identifier: string
): Promise<RateLimitResult> {
  const isDevelopment = process.env.NODE_ENV === "development";

  try {
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
