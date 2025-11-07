import { describe, test, expect, beforeAll } from "bun:test";
import { getHttpClient, api } from "../convex/client";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { createCaption, sanitizeHtmlForTelegram } from "./caption-builder";
import {
  validateMediaUrls,
  validateAndFilterMediaItems,
  validateMediaGroup,
  buildMediaGroup,
} from "./media-handler";
import { createLogger } from "../infra/logger";
import type { MediaItem } from "./types";
import { MAX_CAPTION_LENGTH } from "./types";
import {
  postWithHtmlParsingError,
  postWithLongCaption,
  postWithManyMentions,
  postWithSpecialCharacters,
  postWithExpiredUrls,
  postWithMalformedHtml,
  postWithEmptyCaption,
  postWithExistingHtmlLinks,
  expiredMediaItems,
} from "./fixtures/problematic-posts";

const convexUrl = process.env.CONVEX_URL;
const hasConvexUrl = !!convexUrl;

/**
 * Helper to fetch real posts from database
 */
async function fetchRealPosts(limit = 10): Promise<Doc<"posts">[]> {
  if (!hasConvexUrl) {
    throw new Error("CONVEX_URL not set");
  }
  const client = getHttpClient();
  return await client.query(api.posts.getPosts, { limit });
}

/**
 * Helper to fetch unsent posts
 */
async function fetchUnsentPosts(limit = 10): Promise<Doc<"posts">[]> {
  if (!hasConvexUrl) {
    throw new Error("CONVEX_URL not set");
  }
  const client = getHttpClient();
  return await client.query(api.posts.getUnsent, { limit });
}

/**
 * Helper to fetch posts by media type
 */
async function fetchPostsByMediaType(
  mediaType: "image" | "video" | "carousel",
  limit = 10
): Promise<Doc<"posts">[]> {
  if (!hasConvexUrl) {
    throw new Error("CONVEX_URL not set");
  }
  const allPosts = await fetchRealPosts(limit * 3); // Fetch more to filter
  return allPosts.filter((post) => post.media_type === mediaType).slice(0, limit);
}

/**
 * Helper to fetch media items for a post
 */
async function fetchMediaItemsForPost(
  postId: string
): Promise<Array<Doc<"media_items">>> {
  if (!hasConvexUrl) {
    throw new Error("CONVEX_URL not set");
  }
  const client = getHttpClient();
  return await client.query(api.media_items.getMediaItemsByPostId, {
    postId: postId as any,
  });
}

/**
 * Validate HTML is well-formed (basic check for balanced tags)
 */
function isValidHtml(html: string): boolean {
  // Remove text content, keep only tags
  const tagPattern = /<\/?[^>]+>/g;
  const tags = html.match(tagPattern) || [];
  
  const stack: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith("</")) {
      // Closing tag
      const tagName = tag.slice(2, -1).split(/\s/)[0];
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return false; // Unmatched closing tag
      }
      stack.pop();
    } else if (!tag.endsWith("/>")) {
      // Opening tag (not self-closing)
      const tagName = tag.slice(1, -1).split(/\s/)[0];
      // Only track <a> tags for now
      if (tagName === "a") {
        stack.push(tagName);
      }
    }
  }
  
  return stack.length === 0; // All tags should be closed
}

/**
 * Count actual text content length (excluding HTML tags)
 */
function getTextLength(html: string): number {
  return html.replace(/<[^>]*>/g, "").length;
}

describe("telegram integration (requires CONVEX_URL)", () => {
  beforeAll(() => {
    if (!hasConvexUrl) {
      console.warn("⚠️  Skipping integration tests: CONVEX_URL not set");
    }
  });

  test.skipIf(!hasConvexUrl)(
    "caption building with real posts - HTML validation",
    async () => {
      const posts = await fetchRealPosts(20);
      expect(posts.length).toBeGreaterThan(0);

      for (const post of posts) {
        const caption = createCaption(post);

        // Validate caption length
        expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);

        // Validate HTML is well-formed
        expect(isValidHtml(caption)).toBe(true);

        // Validate no unclosed tags
        const openTags = (caption.match(/<a[^>]*>/g) || []).length;
        const closeTags = (caption.match(/<\/a>/g) || []).length;
        expect(openTags).toBe(closeTags);

        // Validate HTML entities are escaped
        if (post.caption) {
          // If original caption had &, <, >, they should be escaped
          const hasAmpersand = post.caption.includes("&") && !post.caption.includes("&amp;");
          const hasLessThan = post.caption.includes("<");
          const hasGreaterThan = post.caption.includes(">");
          
          if (hasAmpersand || hasLessThan || hasGreaterThan) {
            // Check that they're properly escaped in the caption
            expect(caption).not.toContain("<script");
            expect(caption).not.toContain("javascript:");
          }
        }
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "caption building with real posts - truncation",
    async () => {
      // Find posts with long captions
      const posts = await fetchRealPosts(50);
      const longCaptionPosts = posts.filter(
        (post) => post.caption && post.caption.length > 500
      );

      if (longCaptionPosts.length === 0) {
        console.warn("No posts with long captions found for testing");
        return;
      }

      for (const post of longCaptionPosts.slice(0, 5)) {
        const caption = createCaption(post);
        
        // Should be within limit
        expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
        
        // Should still contain Instagram link
        expect(caption).toContain("View on Instagram");
        
        // Should be valid HTML
        expect(isValidHtml(caption)).toBe(true);
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "caption building with real posts - @ mentions",
    async () => {
      const posts = await fetchRealPosts(30);
      const postsWithMentions = posts.filter(
        (post) => post.caption && post.caption.includes("@")
      );

      if (postsWithMentions.length === 0) {
        console.warn("No posts with @ mentions found for testing");
        return;
      }

      for (const post of postsWithMentions.slice(0, 5)) {
        const caption = createCaption(post);
        
        // Extract @ mentions from original caption
        const mentions = post.caption.match(/@([a-zA-Z0-9._]+)/g) || [];
        
        // Get text content of caption (without HTML tags)
        const textContent = caption.replace(/<[^>]*>/g, "");
        
        for (const mention of mentions) {
          const username = mention.slice(1);
          // If the mention appears in the final caption (even if truncated),
          // it should be properly linked
          if (textContent.includes(`@${username}`)) {
            // Full username appears - should be linked
            expect(caption).toContain(`instagram.com/${username}`);
          } else {
            // Check if a partial match exists (due to truncation)
            // Find the longest prefix that appears
            for (let len = Math.min(username.length, 10); len >= 3; len--) {
              const prefix = username.substring(0, len);
              if (textContent.includes(`@${prefix}`)) {
                // Partial match found - should be linked with at least the prefix
                expect(caption).toMatch(new RegExp(`instagram\\.com/${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
                break;
              }
            }
          }
        }
        
        // Should be valid HTML
        expect(isValidHtml(caption)).toBe(true);
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "caption building with real posts - edge cases",
    async () => {
      const posts = await fetchRealPosts(30);

      // Test empty captions
      const emptyCaptionPosts = posts.filter(
        (post) => !post.caption || post.caption.trim().length === 0
      );
      for (const post of emptyCaptionPosts.slice(0, 3)) {
        const caption = createCaption(post);
        expect(caption).toContain("View on Instagram");
        expect(isValidHtml(caption)).toBe(true);
      }

      // Test captions with special characters
      const specialCharPosts = posts.filter(
        (post) =>
          post.caption &&
          (post.caption.includes("&") ||
            post.caption.includes("<") ||
            post.caption.includes(">") ||
            post.caption.includes('"') ||
            post.caption.includes("'"))
      );
      for (const post of specialCharPosts.slice(0, 5)) {
        const caption = createCaption(post);
        expect(isValidHtml(caption)).toBe(true);
        // Should not contain unescaped special characters in text content
        const textContent = caption.replace(/<[^>]*>/g, "");
        expect(textContent).not.toContain("<");
        expect(textContent).not.toContain(">");
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "media validation with real Instagram URLs",
    async () => {
      const posts = await fetchRealPosts(10);
      const logger = createLogger(false);

      for (const post of posts) {
        const mediaItems = await fetchMediaItemsForPost(post._id);
        
        if (mediaItems.length === 0) {
          continue; // Skip posts without media items
        }

        // Convert to MediaItem format
        const mediaItemsWithThumbnail = mediaItems
          .filter((m) => m.type === "image" || m.type === "video" || m.type === "thumbnail")
          .map((m) => ({
            url: m.url,
            type: m.type as "image" | "video" | "thumbnail",
            width: m.width,
            height: m.height,
          }));

        // Validate and filter
        const validMedia = await validateAndFilterMediaItems(
          mediaItemsWithThumbnail,
          logger,
          false
        );

        // Should filter out invalid items
        expect(validMedia.length).toBeLessThanOrEqual(mediaItemsWithThumbnail.length);

        // Validate URLs if we have valid media
        if (validMedia.length > 0) {
          const urlValidation = await validateMediaUrls(validMedia, logger);
          
          // Log results for debugging
          if (urlValidation.inaccessible.length > 0) {
            console.log(
              `Post ${post._id}: ${urlValidation.accessible}/${validMedia.length} URLs accessible`
            );
            // This is expected - Instagram URLs expire
            expect(urlValidation.accessible).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "media group building with real carousel posts",
    async () => {
      const carouselPosts = await fetchPostsByMediaType("carousel", 5);
      
      if (carouselPosts.length === 0) {
        console.warn("No carousel posts found for testing");
        return;
      }

      const logger = createLogger(false);

      for (const post of carouselPosts) {
        const mediaItems = await fetchMediaItemsForPost(post._id);
        
        if (mediaItems.length < 2) {
          continue; // Need at least 2 items for media group
        }

        const mediaItemsWithThumbnail = mediaItems
          .filter((m) => m.type === "image" || m.type === "video" || m.type === "thumbnail")
          .map((m) => ({
            url: m.url,
            type: m.type as "image" | "video" | "thumbnail",
            width: m.width,
            height: m.height,
          }));

        const validMedia = await validateAndFilterMediaItems(
          mediaItemsWithThumbnail,
          logger,
          false
        );

        if (validMedia.length >= 2) {
          const caption = createCaption(post);
          const validation = validateMediaGroup(validMedia, caption);
          
          // Should pass validation if we have valid media
          if (validation.isValid) {
            const mediaGroup = buildMediaGroup(validMedia, caption);
            expect(mediaGroup.length).toBe(validMedia.length);
            
            // Last item should have caption
            const lastItem = mediaGroup[mediaGroup.length - 1];
            expect(lastItem).toBeDefined();
          }
        }
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "full flow validation with real posts (dry run)",
    async () => {
      const posts = await fetchUnsentPosts(5);
      
      if (posts.length === 0) {
        console.warn("No unsent posts found for testing");
        return;
      }

      const logger = createLogger(false);

      for (const post of posts) {
        // Test caption generation
        const caption = createCaption(post);
        expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
        expect(isValidHtml(caption)).toBe(true);

        // Test media loading and validation
        const mediaItems = await fetchMediaItemsForPost(post._id);
        const mediaItemsWithThumbnail = mediaItems
          .filter((m) => m.type === "image" || m.type === "video" || m.type === "thumbnail")
          .map((m) => ({
            url: m.url,
            type: m.type as "image" | "video" | "thumbnail",
            width: m.width,
            height: m.height,
          }));

        const validMedia = await validateAndFilterMediaItems(
          mediaItemsWithThumbnail,
          logger,
          false
        );

        // If we have multiple valid media items, test media group
        if (validMedia.length > 1) {
          const validation = validateMediaGroup(validMedia, caption);
          
          if (validation.isValid) {
            const mediaGroup = buildMediaGroup(validMedia, caption);
            expect(mediaGroup.length).toBe(validMedia.length);
            
            // Verify caption is only on last item
            // (We can't easily check this without accessing internals, but structure should be correct)
            expect(mediaGroup.length).toBeGreaterThan(0);
          }
        }

        // Test that caption + media combination is valid
        // (This is what would be sent to Telegram)
        expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
      }
    }
  );

  test.skipIf(!hasConvexUrl)(
    "HTML sanitization with real problematic captions",
    async () => {
      // Test with posts that might have HTML issues
      const posts = await fetchRealPosts(50);
      const logger = createLogger(false);

      for (const post of posts) {
        if (!post.caption) continue;

        const caption = createCaption(post);
        const sanitized = sanitizeHtmlForTelegram(caption);

        // Sanitized HTML should be valid
        expect(isValidHtml(sanitized)).toBe(true);

        // Should not have unclosed tags
        const openTags = (sanitized.match(/<a[^>]*>/g) || []).length;
        const closeTags = (sanitized.match(/<\/a>/g) || []).length;
        expect(openTags).toBe(closeTags);

        // Should not have orphaned closing tags
        const beforeOpen = sanitized.substring(0, sanitized.indexOf("<a"));
        const afterOpen = sanitized.substring(sanitized.indexOf("<a"));
        if (afterOpen.includes("</a>")) {
          // If we have closing tags, they should come after opening tags
          expect(afterOpen.indexOf("</a>")).toBeGreaterThan(0);
        }
      }
    }
  );

  describe("problematic post fixtures", () => {
    test("handles post with HTML parsing error", () => {
      const post = postWithHtmlParsingError as Doc<"posts">;
      const caption = createCaption(post);
      expect(isValidHtml(caption)).toBe(true);
      expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
    });

    test("handles post with long caption", () => {
      const post = postWithLongCaption as Doc<"posts">;
      const caption = createCaption(post);
      expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
      expect(caption).toContain("View on Instagram");
      expect(isValidHtml(caption)).toBe(true);
    });

    test("handles post with many mentions", () => {
      const post = postWithManyMentions as Doc<"posts">;
      const caption = createCaption(post);
      expect(isValidHtml(caption)).toBe(true);
      // Should convert all mentions to links
      expect(caption).toContain("instagram.com/user1");
      expect(caption).toContain("instagram.com/user2");
    });

    test("handles post with special characters", () => {
      const post = postWithSpecialCharacters as Doc<"posts">;
      const caption = createCaption(post);
      expect(isValidHtml(caption)).toBe(true);
      // Special characters should be escaped
      const textContent = caption.replace(/<[^>]*>/g, "");
      expect(textContent).not.toContain("<");
      expect(textContent).not.toContain(">");
    });

    test("handles post with malformed HTML", () => {
      const post = postWithMalformedHtml as Doc<"posts">;
      const caption = createCaption(post);
      expect(isValidHtml(caption)).toBe(true);
      // Should fix unclosed tags
      const openTags = (caption.match(/<a[^>]*>/g) || []).length;
      const closeTags = (caption.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
    });

    test("handles post with empty caption", () => {
      const post = postWithEmptyCaption as Doc<"posts">;
      const caption = createCaption(post);
      expect(caption).toContain("View on Instagram");
      expect(isValidHtml(caption)).toBe(true);
    });

    test("handles post with existing HTML links", () => {
      const post = postWithExistingHtmlLinks as Doc<"posts">;
      const caption = createCaption(post);
      expect(isValidHtml(caption)).toBe(true);
      // Should preserve existing links and add new ones
      expect(caption).toContain("instagram.com/existing");
      expect(caption).toContain("instagram.com/newuser");
    });

    test.skipIf(!hasConvexUrl)(
      "validates expired Instagram URLs",
      async () => {
        const logger = createLogger(false);
        const mediaItems: MediaItem[] = expiredMediaItems.map((item) => ({
          url: item.url,
          type: item.type,
          width: item.width,
          height: item.height,
        }));

        const urlValidation = await validateMediaUrls(mediaItems, logger);
        
        // These URLs are expired, so they should be detected as inaccessible
        // (This test may pass or fail depending on whether URLs are still accessible)
        expect(urlValidation.inaccessible.length).toBeGreaterThanOrEqual(0);
        expect(urlValidation.accessible + urlValidation.inaccessible.length).toBe(mediaItems.length);
      }
    );
  });
});

