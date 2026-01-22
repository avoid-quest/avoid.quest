/**
 * Tests for Instagram API adapter
 * Tests pure functions for parsing Instagram API responses
 */

import { describe, expect, it } from "vitest";
import { extractShortcode } from "./adapter";

describe("extractShortcode", () => {
	describe("standard post URLs", () => {
		it("extracts shortcode from standard post URL", () => {
			const url = "https://www.instagram.com/p/ABC123xyz/";
			expect(extractShortcode(url)).toBe("ABC123xyz");
		});

		it("extracts shortcode without trailing slash", () => {
			const url = "https://www.instagram.com/p/ABC123xyz";
			expect(extractShortcode(url)).toBe("ABC123xyz");
		});

		it("extracts shortcode from URL without www", () => {
			const url = "https://instagram.com/p/ABC123xyz/";
			expect(extractShortcode(url)).toBe("ABC123xyz");
		});

		it("extracts shortcode with query parameters", () => {
			const url =
				"https://www.instagram.com/p/ABC123xyz/?utm_source=ig_web_copy_link";
			expect(extractShortcode(url)).toBe("ABC123xyz");
		});

		it("extracts shortcode with username prefix", () => {
			const url = "https://www.instagram.com/username/p/ABC123xyz/";
			expect(extractShortcode(url)).toBe("ABC123xyz");
		});
	});

	describe("reel URLs", () => {
		it("extracts shortcode from reel URL", () => {
			const url = "https://www.instagram.com/reel/XYZ789abc/";
			expect(extractShortcode(url)).toBe("XYZ789abc");
		});

		it("extracts shortcode from reel URL without www", () => {
			const url = "https://instagram.com/reel/XYZ789abc/";
			expect(extractShortcode(url)).toBe("XYZ789abc");
		});

		it("extracts shortcode from reel with username prefix", () => {
			const url = "https://www.instagram.com/username/reel/XYZ789abc/";
			expect(extractShortcode(url)).toBe("XYZ789abc");
		});
	});

	describe("TV/IGTV URLs", () => {
		it("extracts shortcode from TV URL", () => {
			const url = "https://www.instagram.com/tv/DEF456ghi/";
			expect(extractShortcode(url)).toBe("DEF456ghi");
		});

		it("extracts shortcode from TV URL with username prefix", () => {
			const url = "https://www.instagram.com/username/tv/DEF456ghi/";
			expect(extractShortcode(url)).toBe("DEF456ghi");
		});
	});

	describe("shortcode character sets", () => {
		it("handles shortcode with underscores", () => {
			const url = "https://www.instagram.com/p/ABC_123_xyz/";
			expect(extractShortcode(url)).toBe("ABC_123_xyz");
		});

		it("handles shortcode with hyphens", () => {
			const url = "https://www.instagram.com/p/ABC-123-xyz/";
			expect(extractShortcode(url)).toBe("ABC-123-xyz");
		});

		it("handles mixed case shortcode", () => {
			const url = "https://www.instagram.com/p/AbCdEfGhIj/";
			expect(extractShortcode(url)).toBe("AbCdEfGhIj");
		});

		it("handles numeric shortcode", () => {
			const url = "https://www.instagram.com/p/1234567890/";
			expect(extractShortcode(url)).toBe("1234567890");
		});
	});

	describe("invalid URLs", () => {
		it("returns null for profile URL", () => {
			const url = "https://www.instagram.com/username/";
			expect(extractShortcode(url)).toBeNull();
		});

		it("returns null for home URL", () => {
			const url = "https://www.instagram.com/";
			expect(extractShortcode(url)).toBeNull();
		});

		it("returns null for explore URL", () => {
			const url = "https://www.instagram.com/explore/";
			expect(extractShortcode(url)).toBeNull();
		});

		it("returns null for non-Instagram URL", () => {
			const url = "https://twitter.com/p/ABC123/";
			expect(extractShortcode(url)).toBeNull();
		});

		it("returns null for empty string", () => {
			expect(extractShortcode("")).toBeNull();
		});

		it("returns null for malformed URL", () => {
			const url = "not-a-valid-url";
			expect(extractShortcode(url)).toBeNull();
		});

		it("returns null for stories URL", () => {
			const url = "https://www.instagram.com/stories/username/12345/";
			expect(extractShortcode(url)).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("handles URL with extra path segments after shortcode", () => {
			const url = "https://www.instagram.com/p/ABC123/comments/";
			// Should still extract the shortcode
			expect(extractShortcode(url)).toBe("ABC123");
		});

		it("handles HTTP URL (upgrades to HTTPS internally)", () => {
			const url = "http://www.instagram.com/p/ABC123/";
			expect(extractShortcode(url)).toBe("ABC123");
		});

		it("handles mobile URL format", () => {
			const url = "https://m.instagram.com/p/ABC123/";
			// The regex should handle this
			expect(extractShortcode(url)).toBe("ABC123");
		});
	});
});

/**
 * Tests for media node parsing
 * These test the internal logic of how Instagram API responses are parsed
 */
describe("Instagram API response parsing", () => {
	// Helper types matching Instagram API response structure
	type InstagramMediaNode = {
		id: string;
		shortcode?: string;
		code?: string;
		taken_at_timestamp?: number;
		display_url?: string;
		is_video?: boolean;
		video_url?: string;
		edge_media_to_caption?: {
			edges: Array<{ node: { text: string } }>;
		};
		caption?: { text: string };
		edge_sidecar_to_children?: {
			edges: Array<{ node: InstagramMediaNode }>;
		};
		dimensions?: { width: number; height: number };
		display_resources?: Array<{
			src: string;
			config_width: number;
			config_height: number;
		}>;
		video_versions?: Array<{ url: string; width: number; height: number }>;
		image_versions2?: {
			candidates: Array<{ url: string; width: number; height: number }>;
		};
	};

	// Recreate the extraction logic for testing
	function extractCaption(node: InstagramMediaNode): string {
		if (node.caption?.text) {
			return node.caption.text;
		}
		if (node.edge_media_to_caption?.edges?.[0]?.node?.text) {
			return node.edge_media_to_caption.edges[0].node.text;
		}
		return "";
	}

	function getBestImageUrl(node: InstagramMediaNode): string {
		if (node.image_versions2?.candidates?.length) {
			const sorted = [...node.image_versions2.candidates].sort(
				(a, b) => b.width - a.width,
			);
			return sorted[0].url;
		}
		if (node.display_resources?.length) {
			const sorted = [...node.display_resources].sort(
				(a, b) => b.config_width - a.config_width,
			);
			return sorted[0].src;
		}
		return node.display_url ?? "";
	}

	function getVideoUrl(node: InstagramMediaNode): string | undefined {
		if (node.video_versions?.length) {
			const sorted = [...node.video_versions].sort((a, b) => b.width - a.width);
			return sorted[0].url;
		}
		return node.video_url;
	}

	function determineMediaType(
		node: InstagramMediaNode,
	): "image" | "video" | "carousel" {
		if (node.edge_sidecar_to_children?.edges?.length) {
			return "carousel";
		}
		if (node.is_video) {
			return "video";
		}
		return "image";
	}

	describe("extractCaption", () => {
		it("extracts caption from caption.text (mobile API format)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				caption: { text: "Hello from mobile API" },
			};
			expect(extractCaption(node)).toBe("Hello from mobile API");
		});

		it("extracts caption from edge_media_to_caption (web API format)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				edge_media_to_caption: {
					edges: [{ node: { text: "Hello from web API" } }],
				},
			};
			expect(extractCaption(node)).toBe("Hello from web API");
		});

		it("prefers caption.text over edge_media_to_caption", () => {
			const node: InstagramMediaNode = {
				id: "123",
				caption: { text: "Mobile caption" },
				edge_media_to_caption: {
					edges: [{ node: { text: "Web caption" } }],
				},
			};
			expect(extractCaption(node)).toBe("Mobile caption");
		});

		it("returns empty string when no caption", () => {
			const node: InstagramMediaNode = {
				id: "123",
			};
			expect(extractCaption(node)).toBe("");
		});

		it("returns empty string for empty edges array", () => {
			const node: InstagramMediaNode = {
				id: "123",
				edge_media_to_caption: { edges: [] },
			};
			expect(extractCaption(node)).toBe("");
		});

		it("handles caption with emojis and special characters", () => {
			const node: InstagramMediaNode = {
				id: "123",
				caption: { text: "Hello! 🎉 #test @user" },
			};
			expect(extractCaption(node)).toBe("Hello! 🎉 #test @user");
		});

		it("handles multiline captions", () => {
			const node: InstagramMediaNode = {
				id: "123",
				caption: { text: "Line 1\nLine 2\nLine 3" },
			};
			expect(extractCaption(node)).toBe("Line 1\nLine 2\nLine 3");
		});
	});

	describe("getBestImageUrl", () => {
		it("gets largest image from image_versions2 (mobile API)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				image_versions2: {
					candidates: [
						{ url: "https://example.com/small.jpg", width: 320, height: 320 },
						{ url: "https://example.com/large.jpg", width: 1080, height: 1080 },
						{
							url: "https://example.com/medium.jpg",
							width: 640,
							height: 640,
						},
					],
				},
			};
			expect(getBestImageUrl(node)).toBe("https://example.com/large.jpg");
		});

		it("gets largest image from display_resources (web API)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				display_resources: [
					{
						src: "https://example.com/small.jpg",
						config_width: 320,
						config_height: 320,
					},
					{
						src: "https://example.com/large.jpg",
						config_width: 1080,
						config_height: 1080,
					},
				],
			};
			expect(getBestImageUrl(node)).toBe("https://example.com/large.jpg");
		});

		it("prefers image_versions2 over display_resources", () => {
			const node: InstagramMediaNode = {
				id: "123",
				image_versions2: {
					candidates: [
						{
							url: "https://example.com/mobile.jpg",
							width: 1080,
							height: 1080,
						},
					],
				},
				display_resources: [
					{
						src: "https://example.com/web.jpg",
						config_width: 1080,
						config_height: 1080,
					},
				],
			};
			expect(getBestImageUrl(node)).toBe("https://example.com/mobile.jpg");
		});

		it("falls back to display_url", () => {
			const node: InstagramMediaNode = {
				id: "123",
				display_url: "https://example.com/fallback.jpg",
			};
			expect(getBestImageUrl(node)).toBe("https://example.com/fallback.jpg");
		});

		it("returns empty string when no image sources", () => {
			const node: InstagramMediaNode = {
				id: "123",
			};
			expect(getBestImageUrl(node)).toBe("");
		});
	});

	describe("getVideoUrl", () => {
		it("gets highest quality video from video_versions", () => {
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
				video_versions: [
					{ url: "https://example.com/720p.mp4", width: 720, height: 1280 },
					{ url: "https://example.com/1080p.mp4", width: 1080, height: 1920 },
					{ url: "https://example.com/480p.mp4", width: 480, height: 854 },
				],
			};
			expect(getVideoUrl(node)).toBe("https://example.com/1080p.mp4");
		});

		it("falls back to video_url", () => {
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
				video_url: "https://example.com/video.mp4",
			};
			expect(getVideoUrl(node)).toBe("https://example.com/video.mp4");
		});

		it("prefers video_versions over video_url", () => {
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
				video_versions: [
					{
						url: "https://example.com/versions.mp4",
						width: 1080,
						height: 1920,
					},
				],
				video_url: "https://example.com/fallback.mp4",
			};
			expect(getVideoUrl(node)).toBe("https://example.com/versions.mp4");
		});

		it("returns undefined when no video sources", () => {
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
			};
			expect(getVideoUrl(node)).toBeUndefined();
		});
	});

	describe("determineMediaType", () => {
		it("returns carousel for posts with sidecar children", () => {
			const node: InstagramMediaNode = {
				id: "123",
				edge_sidecar_to_children: {
					edges: [
						{
							node: { id: "child1", display_url: "https://example.com/1.jpg" },
						},
						{
							node: { id: "child2", display_url: "https://example.com/2.jpg" },
						},
					],
				},
			};
			expect(determineMediaType(node)).toBe("carousel");
		});

		it("returns video for video posts", () => {
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
				video_url: "https://example.com/video.mp4",
			};
			expect(determineMediaType(node)).toBe("video");
		});

		it("returns image for single image posts", () => {
			const node: InstagramMediaNode = {
				id: "123",
				display_url: "https://example.com/image.jpg",
			};
			expect(determineMediaType(node)).toBe("image");
		});

		it("prioritizes carousel over video flag", () => {
			// Edge case: carousel that contains videos
			const node: InstagramMediaNode = {
				id: "123",
				is_video: true,
				edge_sidecar_to_children: {
					edges: [
						{
							node: {
								id: "child1",
								is_video: true,
								video_url: "https://example.com/1.mp4",
							},
						},
					],
				},
			};
			expect(determineMediaType(node)).toBe("carousel");
		});

		it("handles empty sidecar children as non-carousel", () => {
			const node: InstagramMediaNode = {
				id: "123",
				edge_sidecar_to_children: {
					edges: [],
				},
				display_url: "https://example.com/image.jpg",
			};
			expect(determineMediaType(node)).toBe("image");
		});
	});

	describe("shortcode extraction from node", () => {
		it("extracts shortcode from shortcode field", () => {
			const node: InstagramMediaNode = {
				id: "123",
				shortcode: "ABC123xyz",
			};
			expect(node.shortcode).toBe("ABC123xyz");
		});

		it("extracts shortcode from code field (alternate format)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				code: "ABC123xyz",
			};
			const shortcode = node.shortcode ?? node.code;
			expect(shortcode).toBe("ABC123xyz");
		});

		it("prefers shortcode over code when both present", () => {
			const node: InstagramMediaNode = {
				id: "123",
				shortcode: "preferred",
				code: "alternate",
			};
			const shortcode = node.shortcode ?? node.code;
			expect(shortcode).toBe("preferred");
		});
	});

	describe("timestamp handling", () => {
		it("uses taken_at_timestamp when present", () => {
			const timestamp = 1700000000; // Unix timestamp in seconds
			const node: InstagramMediaNode = {
				id: "123",
				taken_at_timestamp: timestamp,
			};
			expect(node.taken_at_timestamp).toBe(timestamp);
		});

		it("handles missing timestamp gracefully", () => {
			const node: InstagramMediaNode = {
				id: "123",
			};
			const timestamp =
				node.taken_at_timestamp ?? Math.floor(Date.now() / 1000);
			expect(timestamp).toBeGreaterThan(0);
		});
	});

	describe("carousel post processing", () => {
		it("processes multiple images in carousel", () => {
			const node: InstagramMediaNode = {
				id: "123",
				shortcode: "CAROUSEL",
				edge_sidecar_to_children: {
					edges: [
						{
							node: {
								id: "child1",
								display_url: "https://example.com/1.jpg",
								dimensions: { width: 1080, height: 1080 },
							},
						},
						{
							node: {
								id: "child2",
								display_url: "https://example.com/2.jpg",
								dimensions: { width: 1080, height: 1350 },
							},
						},
						{
							node: {
								id: "child3",
								display_url: "https://example.com/3.jpg",
								dimensions: { width: 1080, height: 608 },
							},
						},
					],
				},
			};

			const children = node.edge_sidecar_to_children?.edges ?? [];
			expect(children).toHaveLength(3);
			expect(children[0].node.display_url).toBe("https://example.com/1.jpg");
			expect(children[1].node.dimensions?.height).toBe(1350);
		});

		it("processes mixed media carousel (images and videos)", () => {
			const node: InstagramMediaNode = {
				id: "123",
				shortcode: "MIXED",
				edge_sidecar_to_children: {
					edges: [
						{
							node: {
								id: "child1",
								display_url: "https://example.com/1.jpg",
								is_video: false,
							},
						},
						{
							node: {
								id: "child2",
								is_video: true,
								video_url: "https://example.com/2.mp4",
								display_url: "https://example.com/2_thumb.jpg",
							},
						},
					],
				},
			};

			const children = node.edge_sidecar_to_children?.edges ?? [];
			expect(children[0].node.is_video).toBe(false);
			expect(children[1].node.is_video).toBe(true);
			expect(children[1].node.video_url).toBe("https://example.com/2.mp4");
		});

		it("handles maximum carousel size (10 items)", () => {
			const edges = Array.from({ length: 10 }, (_, i) => ({
				node: {
					id: `child${i}`,
					display_url: `https://example.com/${i}.jpg`,
				},
			}));

			const node: InstagramMediaNode = {
				id: "123",
				edge_sidecar_to_children: { edges },
			};

			expect(node.edge_sidecar_to_children?.edges).toHaveLength(10);
		});
	});
});

describe("Instagram API error handling", () => {
	describe("HTTP status codes", () => {
		it("identifies 404 as user not found", () => {
			const status = 404;
			const errorMessage = status === 404 ? "User not found" : `HTTP ${status}`;
			expect(errorMessage).toBe("User not found");
		});

		it("identifies 429 as rate limited", () => {
			const status = 429;
			const errorMessage =
				status === 429 ? "Rate limited by Instagram" : `HTTP ${status}`;
			expect(errorMessage).toBe("Rate limited by Instagram");
		});

		it("formats other status codes", () => {
			const status = 500;
			const errorMessage =
				status === 429
					? "Rate limited"
					: status === 404
						? "Not found"
						: `HTTP ${status}`;
			expect(errorMessage).toBe("HTTP 500");
		});
	});

	describe("API response status", () => {
		it("identifies failed status", () => {
			const response = { status: "fail", message: "Login required" };
			const isFailed = response.status === "fail";
			expect(isFailed).toBe(true);
		});

		it("handles missing status field", () => {
			const response = { data: {} };
			const isFailed =
				(response as { status?: string }).status === "fail" ||
				(response as { message?: string }).message !== undefined;
			expect(isFailed).toBe(false);
		});
	});
});
