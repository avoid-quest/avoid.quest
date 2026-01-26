/**
 * Convert a Pinterest CDN URL to a proxied URL that bypasses CORS
 *
 * Both <img> elements and PixiJS textures should use this same proxy URL
 * to ensure the browser caches the response with proper CORS headers.
 */
export function getProxiedImageUrl(originalUrl: string): string {
  if (!originalUrl.startsWith("https://i.pinimg.com/")) {
    return originalUrl;
  }
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}
