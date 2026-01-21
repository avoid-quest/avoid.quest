import { describe, expect, test } from "bun:test";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import {
  createCaption,
  escapeHtmlEntities,
  linkMentions,
} from "./caption-builder";

const LONG_CAPTION_LENGTH = 2000;
const MAX_CAPTION_LENGTH_VALUE = 1024;

describe("caption-builder", () => {
  describe("escapeHtmlEntities", () => {
    test("escapes HTML entities correctly", () => {
      expect(escapeHtmlEntities("Hello & World")).toBe("Hello &amp; World");
      expect(escapeHtmlEntities("<tag>")).toBe("&lt;tag&gt;");
      expect(escapeHtmlEntities('"quotes"')).toBe("&quot;quotes&quot;");
      // Single quotes are not escaped (not required by Telegram HTML mode)
      expect(escapeHtmlEntities("'apostrophe'")).toBe("'apostrophe'");
    });

    test("handles empty string", () => {
      expect(escapeHtmlEntities("")).toBe("");
    });

    test("handles string with no special characters", () => {
      expect(escapeHtmlEntities("Hello World")).toBe("Hello World");
    });
  });

  describe("linkMentions", () => {
    test("converts @ mentions to Instagram links", () => {
      const result = linkMentions("Hello @username world");
      expect(result).toContain(
        '<a href="https://instagram.com/username">@username</a>'
      );
    });

    test("handles multiple mentions", () => {
      const result = linkMentions("Hello @user1 and @user2");
      expect(result).toContain("instagram.com/user1");
      expect(result).toContain("instagram.com/user2");
    });

    test("handles mentions with underscores and dots", () => {
      const result = linkMentions("Hello @user_name.test");
      expect(result).toContain("instagram.com/user_name.test");
    });

    test("handles empty string", () => {
      expect(linkMentions("")).toBe("");
    });
  });

  describe("createCaption", () => {
    test("creates caption with post caption and Instagram link", () => {
      const post: Doc<"posts"> = {
        _id: "test-id" as any,
        _creationTime: Date.now(),
        ig_id: "123",
        shortcode: "abc123",
        display_url: "https://example.com/image.jpg",
        caption: "Test caption",
        is_video: false,
        url: "https://instagram.com/p/abc123",
        media_type: "image",
        timestamp: Date.now(),
        users: [],
        sent: false,
      };

      const result = createCaption(post);
      expect(result).toContain("Test caption");
      expect(result).toContain('href="https://instagram.com/p/abc123"');
      expect(result).toContain("View on Instagram");
    });

    test("escapes HTML in caption", () => {
      const post: Doc<"posts"> = {
        _id: "test-id" as any,
        _creationTime: Date.now(),
        ig_id: "123",
        shortcode: "abc123",
        display_url: "https://example.com/image.jpg",
        caption: "Test & <tag>",
        is_video: false,
        url: "https://instagram.com/p/abc123",
        media_type: "image",
        timestamp: Date.now(),
        users: [],
        sent: false,
      };

      const result = createCaption(post);
      expect(result).toContain("&amp;");
      expect(result).toContain("&lt;tag&gt;");
    });

    test("converts @ mentions in caption", () => {
      const post: Doc<"posts"> = {
        _id: "test-id" as any,
        _creationTime: Date.now(),
        ig_id: "123",
        shortcode: "abc123",
        display_url: "https://example.com/image.jpg",
        caption: "Hello @username",
        is_video: false,
        url: "https://instagram.com/p/abc123",
        media_type: "image",
        timestamp: Date.now(),
        users: [],
        sent: false,
      };

      const result = createCaption(post);
      expect(result).toContain("instagram.com/username");
    });

    test("handles empty caption", () => {
      const post: Doc<"posts"> = {
        _id: "test-id" as any,
        _creationTime: Date.now(),
        ig_id: "123",
        shortcode: "abc123",
        display_url: "https://example.com/image.jpg",
        caption: "",
        is_video: false,
        url: "https://instagram.com/p/abc123",
        media_type: "image",
        timestamp: Date.now(),
        users: [],
        sent: false,
      };

      const result = createCaption(post);
      expect(result).toContain("View on Instagram");
    });

    test("truncates long captions", () => {
      const longCaption = "A".repeat(LONG_CAPTION_LENGTH);
      const post: Doc<"posts"> = {
        _id: "test-id" as any,
        _creationTime: Date.now(),
        ig_id: "123",
        shortcode: "abc123",
        display_url: "https://example.com/image.jpg",
        caption: longCaption,
        is_video: false,
        url: "https://instagram.com/p/abc123",
        media_type: "image",
        timestamp: Date.now(),
        users: [],
        sent: false,
      };

      const result = createCaption(post);
      // Should be truncated to MAX_CAPTION_LENGTH (1024)
      expect(result.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH_VALUE);
      expect(result).toContain("View on Instagram");
    });
  });
});
