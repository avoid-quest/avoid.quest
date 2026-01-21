/**
 * Tests for caption formatting utilities
 */

import { describe, expect, it } from "vitest";
import {
	bold,
	buildCaption,
	buildMessage,
	escapeHtml,
	instagramFooter,
	instagramMention,
	italic,
	link,
	linkInstagramMentions,
	MAX_CAPTION_LENGTH,
	truncateAtWordBoundary,
	truncateWithFooter,
} from "./captionBuilder";

describe("escapeHtml", () => {
	it("escapes ampersand", () => {
		expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
	});

	it("escapes less than", () => {
		expect(escapeHtml("a < b")).toBe("a &lt; b");
	});

	it("escapes greater than", () => {
		expect(escapeHtml("a > b")).toBe("a &gt; b");
	});

	it("escapes double quotes", () => {
		expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
	});

	it("escapes all special characters together", () => {
		expect(escapeHtml('<script>alert("XSS & Attack")</script>')).toBe(
			"&lt;script&gt;alert(&quot;XSS &amp; Attack&quot;)&lt;/script&gt;",
		);
	});

	it("returns empty string for empty input", () => {
		expect(escapeHtml("")).toBe("");
	});

	it("preserves safe characters", () => {
		expect(escapeHtml("Hello, World!")).toBe("Hello, World!");
	});
});

describe("bold", () => {
	it("wraps text in bold tags", () => {
		expect(bold("important")).toBe("<b>important</b>");
	});

	it("escapes HTML inside bold", () => {
		expect(bold("Tom & Jerry")).toBe("<b>Tom &amp; Jerry</b>");
	});
});

describe("italic", () => {
	it("wraps text in italic tags", () => {
		expect(italic("emphasis")).toBe("<i>emphasis</i>");
	});

	it("escapes HTML inside italic", () => {
		expect(italic("<text>")).toBe("<i>&lt;text&gt;</i>");
	});
});

describe("link", () => {
	it("creates a hyperlink", () => {
		expect(link("Click here", "https://example.com")).toBe(
			'<a href="https://example.com">Click here</a>',
		);
	});

	it("escapes text in link", () => {
		expect(link("Tom & Jerry", "https://example.com")).toBe(
			'<a href="https://example.com">Tom &amp; Jerry</a>',
		);
	});

	it("escapes URL in link", () => {
		expect(link("Link", "https://example.com?a=1&b=2")).toBe(
			'<a href="https://example.com?a=1&amp;b=2">Link</a>',
		);
	});
});

describe("instagramMention", () => {
	it("creates Instagram profile link", () => {
		expect(instagramMention("johndoe")).toBe(
			'<a href="https://instagram.com/johndoe">@johndoe</a>',
		);
	});

	it("strips leading @ from username", () => {
		expect(instagramMention("@johndoe")).toBe(
			'<a href="https://instagram.com/johndoe">@johndoe</a>',
		);
	});
});

describe("linkInstagramMentions", () => {
	it("converts single mention to link", () => {
		const result = linkInstagramMentions("Follow @johndoe for updates");
		expect(result).toContain(
			'<a href="https://instagram.com/johndoe">@johndoe</a>',
		);
	});

	it("converts multiple mentions to links", () => {
		const result = linkInstagramMentions("@alice and @bob are friends");
		expect(result).toContain(
			'<a href="https://instagram.com/alice">@alice</a>',
		);
		expect(result).toContain('<a href="https://instagram.com/bob">@bob</a>');
	});

	it("handles usernames with underscores and dots", () => {
		const result = linkInstagramMentions("Check out @john_doe.123");
		expect(result).toContain(
			'<a href="https://instagram.com/john_doe.123">@john_doe.123</a>',
		);
	});

	it("preserves text without mentions", () => {
		const text = "No mentions here";
		expect(linkInstagramMentions(text)).toBe(text);
	});
});

describe("instagramFooter", () => {
	it("creates footer with Instagram link", () => {
		const footer = instagramFooter("https://instagram.com/p/ABC123/");
		expect(footer).toContain("View on Instagram");
		expect(footer).toContain("https://instagram.com/p/ABC123/");
		expect(footer.startsWith("\n\n")).toBe(true);
	});
});

describe("truncateAtWordBoundary", () => {
	it("returns text unchanged if within limit", () => {
		const text = "Short text";
		expect(truncateAtWordBoundary(text, 100)).toBe(text);
	});

	it("truncates at word boundary", () => {
		const text = "This is a long sentence that needs truncation";
		const result = truncateAtWordBoundary(text, 20);
		expect(result.endsWith("...")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(20);
	});

	it("truncates mid-word if no good break point", () => {
		const text = "Supercalifragilisticexpialidocious";
		const result = truncateAtWordBoundary(text, 15);
		expect(result.endsWith("...")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(15);
	});

	it("handles exact length boundary", () => {
		const text = "Exact";
		expect(truncateAtWordBoundary(text, 5)).toBe("Exact");
	});
});

describe("truncateWithFooter", () => {
	it("returns content with footer if within limit", () => {
		const content = "Short content";
		const footer = "\n\nLink";
		const result = truncateWithFooter(content, footer, 100);
		expect(result).toBe(content + footer);
	});

	it("truncates content to fit footer", () => {
		const content = "This is a very long content that needs truncation";
		const footer = "\n\nView on Instagram";
		const maxLength = 40;
		const result = truncateWithFooter(content, footer, maxLength);

		expect(result.endsWith(footer)).toBe(true);
		expect(result.length).toBeLessThanOrEqual(maxLength);
	});

	it("preserves footer even with long content", () => {
		const content = "A".repeat(1000);
		const footer = "\n\nIMPORTANT FOOTER";
		const maxLength = 100;
		const result = truncateWithFooter(content, footer, maxLength);

		expect(result.endsWith(footer)).toBe(true);
	});
});

describe("buildCaption", () => {
	it("builds caption with escaped HTML and footer", () => {
		const result = buildCaption({
			caption: "Test caption",
			postUrl: "https://instagram.com/p/ABC123/",
		});

		expect(result).toContain("Test caption");
		expect(result).toContain("View on Instagram");
	});

	it("converts Instagram mentions to links", () => {
		const result = buildCaption({
			caption: "Photo by @photographer",
			postUrl: "https://instagram.com/p/ABC123/",
		});

		expect(result).toContain(
			'<a href="https://instagram.com/photographer">@photographer</a>',
		);
	});

	it("escapes HTML in caption", () => {
		const result = buildCaption({
			caption: "Tom & Jerry <3",
			postUrl: "https://instagram.com/p/ABC123/",
		});

		expect(result).toContain("Tom &amp; Jerry &lt;3");
	});

	it("truncates long captions while preserving footer", () => {
		const longCaption = "A".repeat(2000);
		const result = buildCaption({
			caption: longCaption,
			postUrl: "https://instagram.com/p/ABC123/",
			maxLength: MAX_CAPTION_LENGTH,
		});

		expect(result.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
		expect(result).toContain("View on Instagram");
	});

	it("respects custom maxLength", () => {
		const result = buildCaption({
			caption: "This is a test caption with some text",
			postUrl: "https://instagram.com/p/ABC123/",
			maxLength: 80,
		});

		expect(result.length).toBeLessThanOrEqual(80);
	});
});

describe("buildMessage", () => {
	it("escapes HTML in message", () => {
		const result = buildMessage({ text: "Hello <World>" });
		expect(result).toBe("Hello &lt;World&gt;");
	});

	it("truncates long messages", () => {
		const longText = "A".repeat(5000);
		const result = buildMessage({ text: longText, maxLength: 100 });
		expect(result.length).toBeLessThanOrEqual(100);
		expect(result.endsWith("...")).toBe(true);
	});

	it("preserves short messages", () => {
		const result = buildMessage({ text: "Short message" });
		expect(result).toBe("Short message");
	});
});
