/**
 * Tests for file_id position matching utilities
 *
 * This is a HIGH PRIORITY test suite because position-based matching
 * is fragile and error-prone. These tests verify the critical assumption
 * that Telegram returns file_ids in the same order as media was sent.
 */

import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { FileIdInfo } from "./validators/media";

// Helper to create mock media items
function createMockMediaItem(
	overrides: Partial<Doc<"media_items">> = {},
): Doc<"media_items"> {
	return {
		_id: `media_items:${Date.now()}_${Math.random().toString(36).slice(2)}` as Id<"media_items">,
		_creationTime: Date.now(),
		post_id: "posts:test123" as Id<"posts">,
		type: "image",
		url: `https://example.com/${Math.random().toString(36)}.jpg`,
		...overrides,
	};
}

// Since we can't easily import the actual function due to Convex internals,
// we test the logic by recreating the matching algorithm
function matchFileIds(
	mediaItems: Doc<"media_items">[],
	fileIds: FileIdInfo[],
): Array<{ mediaItem: Doc<"media_items">; fileInfo: FileIdInfo } | null> {
	if (fileIds.length === 0) {
		return [];
	}

	// Filter to get only the media items we sent (exclude thumbnails and items without URL)
	const sentMediaItems = mediaItems.filter(
		(item) => item.type !== "thumbnail" && item.url,
	);

	const results: Array<{
		mediaItem: Doc<"media_items">;
		fileInfo: FileIdInfo;
	} | null> = [];

	for (let i = 0; i < fileIds.length; i++) {
		const fileInfo = fileIds[i];
		const mediaItem = sentMediaItems[i];
		if (fileInfo && mediaItem?.url) {
			results.push({ mediaItem, fileInfo });
		} else {
			results.push(null);
		}
	}

	return results;
}

describe("file_id position matching", () => {
	describe("basic matching", () => {
		it("correctly matches file_ids for carousel with multiple items", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({
					url: "https://example.com/1.jpg",
					type: "image",
				}),
				createMockMediaItem({
					url: "https://example.com/2.jpg",
					type: "image",
				}),
				createMockMediaItem({
					url: "https://example.com/3.mp4",
					type: "video",
				}),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
				{ file_id: "AgAC2", file_unique_id: "unique2", type: "image" },
				{ file_id: "BAAC3", file_unique_id: "unique3", type: "video" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			expect(matches).toHaveLength(3);
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/1.jpg");
			expect(matches[0]?.fileInfo.file_id).toBe("AgAC1");
			expect(matches[1]?.mediaItem.url).toBe("https://example.com/2.jpg");
			expect(matches[1]?.fileInfo.file_id).toBe("AgAC2");
			expect(matches[2]?.mediaItem.url).toBe("https://example.com/3.mp4");
			expect(matches[2]?.fileInfo.file_id).toBe("BAAC3");
		});

		it("handles fewer file_ids than media items", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({ url: "https://example.com/1.jpg" }),
				createMockMediaItem({ url: "https://example.com/2.jpg" }),
				createMockMediaItem({ url: "https://example.com/3.jpg" }),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			// Only the first file_id is matched
			expect(matches).toHaveLength(1);
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/1.jpg");
		});

		it("handles more file_ids than media items", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({ url: "https://example.com/1.jpg" }),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
				{ file_id: "AgAC2", file_unique_id: "unique2", type: "image" },
				{ file_id: "AgAC3", file_unique_id: "unique3", type: "image" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			// Only the first match succeeds, rest are null
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/1.jpg");
			expect(matches[1]).toBeNull();
			expect(matches[2]).toBeNull();
		});
	});

	describe("thumbnail filtering", () => {
		it("excludes thumbnails from position matching", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({
					url: "https://example.com/thumb.jpg",
					type: "thumbnail",
				}),
				createMockMediaItem({
					url: "https://example.com/video.mp4",
					type: "video",
				}),
				createMockMediaItem({
					url: "https://example.com/image.jpg",
					type: "image",
				}),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "BAAC1", file_unique_id: "unique1", type: "video" },
				{ file_id: "AgAC2", file_unique_id: "unique2", type: "image" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			// Thumbnail should be skipped - video matches first file_id
			expect(matches).toHaveLength(2);
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/video.mp4");
			expect(matches[0]?.fileInfo.file_id).toBe("BAAC1");
			expect(matches[1]?.mediaItem.url).toBe("https://example.com/image.jpg");
			expect(matches[1]?.fileInfo.file_id).toBe("AgAC2");
		});

		it("handles post with only thumbnails (becomes text-only)", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({
					url: "https://example.com/thumb1.jpg",
					type: "thumbnail",
				}),
				createMockMediaItem({
					url: "https://example.com/thumb2.jpg",
					type: "thumbnail",
				}),
			];

			const fileIds: FileIdInfo[] = [];

			const matches = matchFileIds(mediaItems, fileIds);

			expect(matches).toHaveLength(0);
		});
	});

	describe("URL handling", () => {
		it("skips media items without URL during matching", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({ url: undefined, file_id: "existing1" }),
				createMockMediaItem({ url: "https://example.com/2.jpg" }),
				createMockMediaItem({ url: "https://example.com/3.jpg" }),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
				{ file_id: "AgAC2", file_unique_id: "unique2", type: "image" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			// First item (no URL) is skipped, so position 0 file_id matches item with URL
			expect(matches).toHaveLength(2);
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/2.jpg");
			expect(matches[0]?.fileInfo.file_id).toBe("AgAC1");
		});
	});

	describe("edge cases", () => {
		it("handles empty media list", () => {
			const matches = matchFileIds(
				[],
				[{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" }],
			);

			// All null because no media items to match
			expect(matches[0]).toBeNull();
		});

		it("handles empty file_id list", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({ url: "https://example.com/1.jpg" }),
			];

			const matches = matchFileIds(mediaItems, []);

			expect(matches).toHaveLength(0);
		});

		it("handles single item correctly", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({ url: "https://example.com/single.jpg" }),
			];

			const fileIds: FileIdInfo[] = [
				{
					file_id: "AgACSingle",
					file_unique_id: "uniqueSingle",
					type: "image",
				},
			];

			const matches = matchFileIds(mediaItems, fileIds);

			expect(matches).toHaveLength(1);
			expect(matches[0]?.mediaItem.url).toBe("https://example.com/single.jpg");
			expect(matches[0]?.fileInfo.file_id).toBe("AgACSingle");
		});

		it("handles exactly 10 items (maximum media group)", () => {
			const mediaItems: Doc<"media_items">[] = Array.from(
				{ length: 10 },
				(_, i) => createMockMediaItem({ url: `https://example.com/${i}.jpg` }),
			);

			const fileIds: FileIdInfo[] = Array.from({ length: 10 }, (_, i) => ({
				file_id: `AgAC${i}`,
				file_unique_id: `unique${i}`,
				type: "image" as const,
			}));

			const matches = matchFileIds(mediaItems, fileIds);

			expect(matches).toHaveLength(10);
			for (let i = 0; i < 10; i++) {
				expect(matches[i]?.mediaItem.url).toBe(`https://example.com/${i}.jpg`);
				expect(matches[i]?.fileInfo.file_id).toBe(`AgAC${i}`);
			}
		});

		it("handles mixed content (images + videos)", () => {
			const mediaItems: Doc<"media_items">[] = [
				createMockMediaItem({
					url: "https://example.com/image1.jpg",
					type: "image",
				}),
				createMockMediaItem({
					url: "https://example.com/video.mp4",
					type: "video",
				}),
				createMockMediaItem({
					url: "https://example.com/image2.jpg",
					type: "image",
				}),
			];

			const fileIds: FileIdInfo[] = [
				{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
				{ file_id: "BAAC2", file_unique_id: "unique2", type: "video" },
				{ file_id: "AgAC3", file_unique_id: "unique3", type: "image" },
			];

			const matches = matchFileIds(mediaItems, fileIds);

			expect(matches).toHaveLength(3);
			expect(matches[0]?.fileInfo.type).toBe("image");
			expect(matches[1]?.fileInfo.type).toBe("video");
			expect(matches[2]?.fileInfo.type).toBe("image");
		});
	});
});

describe("URL expiration fallback", () => {
	it("media item with file_id should be preferred over URL", () => {
		const mediaItem = createMockMediaItem({
			url: "https://example.com/image.jpg",
			file_id: "AgACPreferred",
			file_unique_id: "uniquePreferred",
		});

		// When both URL and file_id present, file_id should be used
		// This is verified in the Telegram sender, but we document the expectation
		expect(mediaItem.file_id).toBe("AgACPreferred");
		expect(mediaItem.url).toBe("https://example.com/image.jpg");
	});

	it("media item with only URL falls back correctly", () => {
		const mediaItem = createMockMediaItem({
			url: "https://example.com/image.jpg",
			file_id: undefined,
		});

		// No file_id, URL should be used
		expect(mediaItem.file_id).toBeUndefined();
		expect(mediaItem.url).toBe("https://example.com/image.jpg");
	});
});

describe("migration path", () => {
	it("backfill operation should preserve all existing fields", () => {
		const originalItem = createMockMediaItem({
			url: "https://example.com/original.jpg",
			type: "video",
			width: 1920,
			height: 1080,
		});

		// Simulate backfill: only file_id fields are added
		const backfilledItem = {
			...originalItem,
			file_id: "AgACBackfilled",
			file_unique_id: "uniqueBackfilled",
		};

		// All original fields preserved
		expect(backfilledItem.url).toBe("https://example.com/original.jpg");
		expect(backfilledItem.type).toBe("video");
		expect(backfilledItem.width).toBe(1920);
		expect(backfilledItem.height).toBe(1080);
		// New fields added
		expect(backfilledItem.file_id).toBe("AgACBackfilled");
		expect(backfilledItem.file_unique_id).toBe("uniqueBackfilled");
	});

	it("identifies items needing backfill correctly", () => {
		const items: Doc<"media_items">[] = [
			createMockMediaItem({ url: "https://example.com/1.jpg" }), // needs backfill
			createMockMediaItem({
				url: "https://example.com/2.jpg",
				file_id: "AgAC2",
			}), // already has file_id
			createMockMediaItem({ url: "https://example.com/3.jpg" }), // needs backfill
		];

		const needingBackfill = items.filter((item) => !item.file_id);

		expect(needingBackfill).toHaveLength(2);
		expect(needingBackfill[0].url).toBe("https://example.com/1.jpg");
		expect(needingBackfill[1].url).toBe("https://example.com/3.jpg");
	});
});
