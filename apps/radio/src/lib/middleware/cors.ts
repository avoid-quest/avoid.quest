/**
 * CORS headers utility for API routes
 */

export type CorsHeaders = Record<string, string>;

/**
 * Get CORS headers for a given origin
 * @param origin - The request origin
 * @returns CORS headers object
 */
export function getCorsHeaders(origin: string): CorsHeaders {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
  };
}

/**
 * Get CORS headers for OPTIONS requests
 * @param origin - The request origin
 * @returns CORS headers object
 */
export function getCorsOptionsHeaders(origin: string): CorsHeaders {
  return getCorsHeaders(origin);
}
