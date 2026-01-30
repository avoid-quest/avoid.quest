/**
 * Media URL utilities for instarip
 */

const CONVEX_SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL as string;

/**
 * Build a media proxy URL from a media item ID
 * Uses the Convex HTTP endpoint to serve media via Telegram
 */
export function getMediaProxyUrl(mediaItemId: string): string {
  return `${CONVEX_SITE_URL}/media?id=${encodeURIComponent(mediaItemId)}`;
}

/**
 * Get the best available image URL for a post
 * Prefers proxy URL (permanent) over display_url (expires)
 */
export function getPostImageUrl(post: {
  display_url: string;
  thumbnail_url?: string;
  proxyImageId?: string;
}): string {
  // Use proxy URL if available (permanent, served via Telegram)
  if (post.proxyImageId) {
    return getMediaProxyUrl(post.proxyImageId);
  }
  // Fall back to Instagram URLs (may expire)
  return post.thumbnail_url || post.display_url;
}

/**
 * Get the best available video URL for a post
 */
export function getPostVideoUrl(post: {
  video_url?: string;
  display_url: string;
  proxyVideoId?: string;
}): string | undefined {
  // Use proxy URL if available
  if (post.proxyVideoId) {
    return getMediaProxyUrl(post.proxyVideoId);
  }
  return post.video_url;
}
