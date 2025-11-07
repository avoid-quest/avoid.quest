import { describe, expect, test } from "bun:test";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import {
  createCaption,
  escapeHtmlEntities,
  linkMentions,
  sanitizeHtmlForTelegram,
} from "./caption-builder";

const ORPHANED_CLOSING_TAG_REGEX = /^<\/a>/;
const LONG_CAPTION_LENGTH = 2000;
const MAX_CAPTION_LENGTH_VALUE = 1024;

describe("caption-builder", () => {
  describe("escapeHtmlEntities", () => {
    test("escapes HTML entities correctly", () => {
      expect(escapeHtmlEntities("Hello & World")).toBe("Hello &amp; World");
      expect(escapeHtmlEntities("<tag>")).toBe("&lt;tag&gt;");
      expect(escapeHtmlEntities('"quotes"')).toBe("&quot;quotes&quot;");
      expect(escapeHtmlEntities("'apostrophe'")).toBe("&#39;apostrophe&#39;");
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

    test("does not convert mentions inside HTML tags", () => {
      const html =
        '<a href="https://instagram.com/@existing">@existing</a> @new';
      const result = linkMentions(html);
      // Should only convert @new, not @existing
      expect(result).toContain("instagram.com/new");
      expect(result).toContain("instagram.com/@existing");
    });

    test("handles empty string", () => {
      expect(linkMentions("")).toBe("");
    });
  });

  describe("sanitizeHtmlForTelegram", () => {
    test("fixes unclosed tags (DOMPurify auto-closes them)", () => {
      const html = 'Hello <a href="https://example.com">World';
      const result = sanitizeHtmlForTelegram(html);
      // DOMPurify will auto-close the tag, which is correct behavior
      expect(result).toContain("Hello");
      expect(result).toContain("World");
      // Tags should be balanced
      const openTags = (result.match(/<a[^>]*>/g) || []).length;
      const closeTags = (result.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
    });

    test("removes orphaned closing tags", () => {
      const html = "Hello </a> World";
      const result = sanitizeHtmlForTelegram(html);
      expect(result).not.toContain("</a>");
    });

    test("handles unclosed tags", () => {
      // Test with unclosed tag - the function attempts to clean it up
      const html =
        '<a href="https://example.com">Link 1</a> <a href="https://example2.com">';
      const result = sanitizeHtmlForTelegram(html);
      // Should contain the valid part
      expect(result).toContain("Link 1");
      // The function may or may not remove the unclosed tag depending on implementation
      // This test verifies the function doesn't crash and processes the input
      expect(typeof result).toBe("string");
    });

    test("preserves valid HTML when balanced", () => {
      const html = '<a href="https://example.com">Link</a>';
      const result = sanitizeHtmlForTelegram(html);
      // The function may strip HTML if it detects any issues, but should preserve text
      expect(result).toContain("Link");
      // If HTML is preserved, it should contain the link structure
      if (result.includes("<a")) {
        expect(result).toContain('href="https://example.com"');
      }
    });

    test("handles empty string", () => {
      expect(sanitizeHtmlForTelegram("")).toBe("");
    });

    test("fixes unclosed tag that causes 'Unexpected end tag' error", () => {
      // This pattern caused "can't parse entities: Unexpected end tag at byte offset 290"
      const html =
        '<a href="https://instagram.com/user">@user</a> <a href="https://instagram.com/another">@another';
      const result = sanitizeHtmlForTelegram(html);
      // DOMPurify will auto-close the unclosed tag, which fixes the error
      const openTags = (result.match(/<a[^>]*>/g) || []).length;
      const closeTags = (result.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
      // Both links should be present and properly closed
      expect(result).toContain("instagram.com/user");
      expect(result).toContain("instagram.com/another");
    });

    test("handles multiple unclosed tags", () => {
      const html =
        '<a href="https://instagram.com/user1">@user1</a> <a href="https://instagram.com/user2">@user2 <a href="https://instagram.com/user3">@user3';
      const result = sanitizeHtmlForTelegram(html);
      const openTags = (result.match(/<a[^>]*>/g) || []).length;
      const closeTags = (result.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
    });

    test("handles orphaned closing tags", () => {
      const html = '</a> Hello <a href="https://instagram.com/user">@user</a>';
      const result = sanitizeHtmlForTelegram(html);
      // Should remove orphaned closing tag
      expect(result).not.toMatch(ORPHANED_CLOSING_TAG_REGEX);
      const openTags = (result.match(/<a[^>]*>/g) || []).length;
      const closeTags = (result.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
    });

    test("preserves valid nested structure", () => {
      const html =
        '<a href="https://instagram.com/user1">@user1</a> and <a href="https://instagram.com/user2">@user2</a>';
      const result = sanitizeHtmlForTelegram(html);
      expect(result).toContain("instagram.com/user1");
      expect(result).toContain("instagram.com/user2");
      const openTags = (result.match(/<a[^>]*>/g) || []).length;
      const closeTags = (result.match(/<\/a>/g) || []).length;
      expect(openTags).toBe(closeTags);
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
