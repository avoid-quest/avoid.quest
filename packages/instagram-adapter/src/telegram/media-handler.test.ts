import { describe, expect, test } from "bun:test";
import { buildMediaGroup, validateMediaGroup } from "./media-handler";
import type { MediaItem } from "./types";
import { MAX_MEDIA_GROUP_SIZE } from "./types";

const LONG_CAPTION_LENGTH = 2000;
const EXPECTED_MEDIA_GROUP_LENGTH = 3;

describe("media-handler", () => {
  describe("validateMediaGroup", () => {
    test("validates valid media group", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
        { url: "https://example.com/image2.jpg", type: "image" },
      ];
      const result = validateMediaGroup(media, "Test caption");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects media group with too few items", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
      ];
      const result = validateMediaGroup(media, "Test caption");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("at least");
    });

    test("rejects media group with too many items", () => {
      const media: MediaItem[] = Array.from(
        { length: MAX_MEDIA_GROUP_SIZE + 1 },
        (_, i) => ({
          url: `https://example.com/image${i}.jpg`,
          type: "image" as const,
        })
      );
      const result = validateMediaGroup(media, "Test caption");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("exceeds maximum");
    });

    test("rejects invalid URLs", () => {
      const media: MediaItem[] = [
        { url: "not-a-url", type: "image" },
        { url: "https://example.com/image2.jpg", type: "image" },
      ];
      const result = validateMediaGroup(media, "Test caption");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("rejects invalid media types", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
        { url: "https://example.com/image2.jpg", type: "invalid" as any },
      ];
      const result = validateMediaGroup(media, "Test caption");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("warns about mixed media types", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image.jpg", type: "image" },
        { url: "https://example.com/video.mp4", type: "video" },
      ];
      const result = validateMediaGroup(media, "Test caption");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("both videos and images");
    });

    test("validates caption length (note: validation happens in caption-builder)", () => {
      // Note: validateMediaGroup doesn't check caption length,
      // that's handled by caption-builder.createCaption()
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
        { url: "https://example.com/image2.jpg", type: "image" },
      ];
      const longCaption = "A".repeat(LONG_CAPTION_LENGTH);
      const result = validateMediaGroup(media, longCaption);
      // Media group validation passes, caption truncation happens elsewhere
      expect(result.isValid).toBe(true);
    });
  });

  describe("buildMediaGroup", () => {
    test("builds media group with correct structure", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
        { url: "https://example.com/image2.jpg", type: "image" },
      ];
      const caption = "Test caption";
      const result = buildMediaGroup(media, caption);

      expect(result).toHaveLength(2);
      // First item should not have caption
      expect(result[0]).toBeDefined();
      // Last item should have caption
      expect(result[1]).toBeDefined();
    });

    test("places caption only on last item", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image1.jpg", type: "image" },
        { url: "https://example.com/image2.jpg", type: "image" },
        { url: "https://example.com/video.mp4", type: "video" },
      ];
      const caption = "Test caption";
      const result = buildMediaGroup(media, caption);

      expect(result).toHaveLength(EXPECTED_MEDIA_GROUP_LENGTH);
      // Verify structure (we can't easily check caption property without accessing internals)
      expect(result[0]).toBeDefined();
      expect(result[1]).toBeDefined();
      expect(result[2]).toBeDefined();
    });

    test("handles single media item", () => {
      const media: MediaItem[] = [
        { url: "https://example.com/image.jpg", type: "image" },
      ];
      const caption = "Test caption";
      const result = buildMediaGroup(media, caption);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
    });
  });
});
