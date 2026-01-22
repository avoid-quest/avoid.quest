/**
 * Tests for Instagram API adapter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	extractShortcode,
	fetchMultipleUsers,
	fetchSinglePost,
	fetchUserPosts,
} from "./adapter";

// Mock the userAgents module
vi.mock("./lib/userAgents", () => ({
	getInstagramHeaders: () => ({
		"User-Agent": "test-agent",
		Accept: "*/*",
	}),
	randomSleep: vi.fn().mockResolvedValue(undefined),
}));

describe("extractShortcode", () => {
	it("extracts from standard post URL (/p/)", () => {
		const url = "https://www.instagram.com/p/ABC123xyz/";
		expect(extractShortcode(url)).toBe("ABC123xyz");
	});

	it("extracts from reel URL (/reel/)", () => {
		const url = "https://www.instagram.com/reel/DEF456abc/";
		expect(extractShortcode(url)).toBe("DEF456abc");
	});

	it("extracts from TV URL (/tv/)", () => {
		const url = "https://www.instagram.com/tv/GHI789def/";
		expect(extractShortcode(url)).toBe("GHI789def");
	});

	it("extracts from URL with username prefix", () => {
		const url = "https://www.instagram.com/johndoe/p/ABC123xyz/";
		expect(extractShortcode(url)).toBe("ABC123xyz");
	});

	it("extracts from URL with query parameters", () => {
		const url =
			"https://www.instagram.com/p/ABC123xyz/?utm_source=ig_web_copy_link";
		expect(extractShortcode(url)).toBe("ABC123xyz");
	});

	it("returns null for invalid URLs", () => {
		expect(extractShortcode("https://instagram.com/johndoe/")).toBeNull();
		expect(extractShortcode("https://example.com/p/ABC123/")).toBeNull();
		expect(extractShortcode("not a url")).toBeNull();
		expect(extractShortcode("")).toBeNull();
	});

	it("handles special characters in shortcode", () => {
		// Instagram shortcodes can contain A-Z, a-z, 0-9, underscore, and hyphen
		const url = "https://www.instagram.com/p/A_B-C123/";
		expect(extractShortcode(url)).toBe("A_B-C123");
	});

	it("handles URLs without trailing slash", () => {
		const url = "https://www.instagram.com/p/ABC123xyz";
		expect(extractShortcode(url)).toBe("ABC123xyz");
	});
});

describe("fetchUserPosts", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockFetch.mockReset();
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns posts on success", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "123",
									shortcode: "ABC123",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image.jpg",
									is_video: false,
									edge_media_to_caption: {
										edges: [{ node: { text: "Test caption" } }],
									},
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(true);
		expect(result.posts).toHaveLength(1);
		expect(result.posts[0].shortcode).toBe("ABC123");
		expect(result.posts[0].caption).toBe("Test caption");
	});

	it("handles 404 (user not found)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const result = await fetchUserPosts("nonexistent");

		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("handles 429 (rate limited)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(false);
		expect(result.error).toContain("Rate limited");
	});

	it("handles API fail status", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					status: "fail",
					message: "User is private",
				}),
		});

		const result = await fetchUserPosts("privateuser");

		expect(result.success).toBe(false);
		expect(result.error).toBe("User is private");
	});

	it("handles timeout", async () => {
		mockFetch.mockImplementationOnce(
			(_url: string, options: { signal?: AbortSignal }) => {
				return new Promise((_, reject) => {
					const error = new Error("Request timeout");
					error.name = "AbortError";
					// Simulate abort
					if (options.signal) {
						options.signal.addEventListener("abort", () => {
							reject(error);
						});
					}
					// Trigger abort immediately for test
					setTimeout(() => reject(error), 0);
				});
			},
		);

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(false);
		expect(result.error).toBe("Request timeout");
	});

	it("parses image post correctly", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "123",
									shortcode: "IMG123",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image.jpg",
									is_video: false,
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(true);
		expect(result.posts[0].media_type).toBe("image");
		expect(result.posts[0].is_video).toBe(false);
	});

	it("parses video post correctly", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "456",
									shortcode: "VID456",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/thumb.jpg",
									is_video: true,
									video_url: "https://example.com/video.mp4",
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(true);
		expect(result.posts[0].media_type).toBe("video");
		expect(result.posts[0].is_video).toBe(true);
		expect(result.posts[0].video_url).toBe("https://example.com/video.mp4");
	});

	it("parses carousel post correctly", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "789",
									shortcode: "CAR789",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image1.jpg",
									is_video: false,
									edge_sidecar_to_children: {
										edges: [
											{
												node: {
													id: "child1",
													display_url: "https://example.com/image1.jpg",
													is_video: false,
												},
											},
											{
												node: {
													id: "child2",
													display_url: "https://example.com/image2.jpg",
													is_video: false,
												},
											},
										],
									},
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.success).toBe(true);
		expect(result.posts[0].media_type).toBe("carousel");
		expect(result.posts[0].media_items.length).toBeGreaterThan(1);
	});

	it("extracts captions from edge_media_to_caption format", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "123",
									shortcode: "ABC123",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image.jpg",
									is_video: false,
									edge_media_to_caption: {
										edges: [{ node: { text: "Caption from edges" } }],
									},
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.posts[0].caption).toBe("Caption from edges");
	});

	it("extracts captions from caption.text format", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "123",
									shortcode: "ABC123",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image.jpg",
									is_video: false,
									caption: { text: "Caption from object" },
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser");

		expect(result.posts[0].caption).toBe("Caption from object");
	});

	it("respects limit parameter", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: Array.from({ length: 10 }, (_, i) => ({
							node: {
								id: `${i}`,
								shortcode: `POST${i}`,
								taken_at_timestamp: 1700000000,
								display_url: "https://example.com/image.jpg",
								is_video: false,
							},
						})),
					},
				},
			},
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const result = await fetchUserPosts("testuser", 3);

		expect(result.success).toBe(true);
		expect(result.posts).toHaveLength(3);
	});

	it("handles network errors gracefully", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"));

		const result = await fetchUserPosts("testuser", 10);

		expect(result.success).toBe(false);
		expect(result.posts).toEqual([]);
		expect(result.error).toBe("Network error");
	});

	it("handles malformed JSON response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
		});

		const result = await fetchUserPosts("testuser", 10);

		expect(result.success).toBe(false);
		expect(result.posts).toEqual([]);
		expect(result.error).toContain("Unexpected token");
	});

	it("handles HTML rate limit page response", async () => {
		// Simulate when Instagram returns HTML instead of JSON (often happens with rate limiting)
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.reject(
					new SyntaxError(
						"Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
					),
				),
		});

		const result = await fetchUserPosts("testuser", 10);

		expect(result.success).toBe(false);
		expect(result.posts).toEqual([]);
		// The error should indicate JSON parsing failure
		expect(result.error).toBeDefined();
	});
});

describe("fetchSinglePost", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockFetch.mockReset();
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns post for valid URL", async () => {
		const mockOembedResponse = {
			title: "Photo caption",
			thumbnail_url: "https://example.com/thumb.jpg",
			author_name: "testuser",
		};

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockOembedResponse),
		});

		const result = await fetchSinglePost(
			"https://www.instagram.com/p/ABC123xyz/",
		);

		expect(result.success).toBe(true);
		expect(result.posts).toHaveLength(1);
		expect(result.posts[0].shortcode).toBe("ABC123xyz");
		expect(result.posts[0].caption).toBe("Photo caption");
	});

	it("returns error for invalid URL", async () => {
		const result = await fetchSinglePost("https://example.com/not-instagram");

		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid Instagram URL");
	});

	it("handles oEmbed errors", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const result = await fetchSinglePost(
			"https://www.instagram.com/p/INVALID123/",
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("404");
	});
});

describe("fetchMultipleUsers", () => {
	const mockFetch = vi.fn();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.useFakeTimers();
		mockFetch.mockReset();
		globalThis.fetch = mockFetch;
	});

	afterEach(() => {
		vi.useRealTimers();
		globalThis.fetch = originalFetch;
	});

	it("fetches for multiple users", async () => {
		const createMockResponse = (username: string) => ({
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: `${username}-1`,
									shortcode: `${username.toUpperCase()}123`,
									taken_at_timestamp: 1700000000,
									display_url: `https://example.com/${username}.jpg`,
									is_video: false,
								},
							},
						],
					},
				},
			},
		});

		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(createMockResponse("user1")),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(createMockResponse("user2")),
			});

		const resultPromise = fetchMultipleUsers(["user1", "user2"], 10);

		// Advance timers to handle delays
		await vi.advanceTimersByTimeAsync(60000);

		const results = await resultPromise;

		expect(results.size).toBe(2);
		expect(results.has("user1")).toBe(true);
		expect(results.has("user2")).toBe(true);
		expect(results.get("user1")?.success).toBe(true);
		expect(results.get("user2")?.success).toBe(true);
	});

	it("calls onUserFetched callback", async () => {
		const mockResponse = {
			data: {
				user: {
					edge_owner_to_timeline_media: {
						edges: [
							{
								node: {
									id: "123",
									shortcode: "ABC123",
									taken_at_timestamp: 1700000000,
									display_url: "https://example.com/image.jpg",
									is_video: false,
								},
							},
						],
					},
				},
			},
		};

		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		});

		const onUserFetched = vi.fn();
		const resultPromise = fetchMultipleUsers(
			["user1", "user2"],
			10,
			onUserFetched,
		);

		await vi.advanceTimersByTimeAsync(60000);

		await resultPromise;

		expect(onUserFetched).toHaveBeenCalledTimes(2);
		expect(onUserFetched).toHaveBeenCalledWith(
			"user1",
			expect.objectContaining({ success: true }),
		);
		expect(onUserFetched).toHaveBeenCalledWith(
			"user2",
			expect.objectContaining({ success: true }),
		);
	});

	it("returns Map with results", async () => {
		mockFetch
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: {
							user: {
								edge_owner_to_timeline_media: { edges: [] },
							},
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 404,
				statusText: "Not Found",
			});

		const resultPromise = fetchMultipleUsers(["user1", "user2"]);

		await vi.advanceTimersByTimeAsync(60000);

		const results = await resultPromise;

		expect(results).toBeInstanceOf(Map);
		expect(results.get("user1")?.success).toBe(true); // Empty posts array
		expect(results.get("user1")?.posts).toHaveLength(0);
		expect(results.get("user2")?.success).toBe(false); // 404
	});
});
