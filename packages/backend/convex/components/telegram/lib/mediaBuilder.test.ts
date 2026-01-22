/**
 * Tests for media group building utilities
 */

import { describe, expect, it } from "vitest";
import {
	buildMediaGroup,
	determineSendStrategy,
	filterMediaItems,
	getPrimaryMedia,
	MAX_MEDIA_GROUP_SIZE,
	type MediaItemInput,
} from "./mediaBuilder";

describe("filterMediaItems", () => {
	it("removes thumbnail items", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
			{ url: "https://example.com/thumb.jpg", type: "thumbnail" },
			{ url: "https://example.com/video.mp4", type: "video" },
		];

		const filtered = filterMediaItems(items);

		expect(filtered).toHaveLength(2);
		expect(filtered.every((item) => item.type !== "thumbnail")).toBe(true);
	});

	it("removes items without url or file_id", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
			{ type: "image" }, // No url or file_id
			{ file_id: "AgACAgIAAxk", type: "video" },
		];

		const filtered = filterMediaItems(items);

		expect(filtered).toHaveLength(2);
	});

	it("limits to MAX_MEDIA_GROUP_SIZE", () => {
		const items: MediaItemInput[] = Array.from({ length: 15 }, (_, i) => ({
			url: `https://example.com/image${i}.jpg`,
			type: "image" as const,
		}));

		const filtered = filterMediaItems(items);

		expect(filtered).toHaveLength(MAX_MEDIA_GROUP_SIZE);
	});

	it("preserves file_id preference over url", () => {
		const items: MediaItemInput[] = [
			{
				url: "https://example.com/image.jpg",
				file_id: "AgACAgIAAxk",
				type: "image",
			},
		];

		const filtered = filterMediaItems(items);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].file_id).toBe("AgACAgIAAxk");
	});

	it("returns empty array for empty input", () => {
		const filtered = filterMediaItems([]);
		expect(filtered).toHaveLength(0);
	});

	it("returns empty array when all items are thumbnails", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/thumb1.jpg", type: "thumbnail" },
			{ url: "https://example.com/thumb2.jpg", type: "thumbnail" },
		];

		const filtered = filterMediaItems(items);
		expect(filtered).toHaveLength(0);
	});
});

describe("buildMediaGroup", () => {
	it("puts caption only on first item", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image1.jpg", type: "image" },
			{ url: "https://example.com/image2.jpg", type: "image" },
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup).toHaveLength(2);
		expect(mediaGroup[0].caption).toBe("Test caption");
		expect(mediaGroup[1].caption).toBeUndefined();
	});

	it("prefers file_id over url in media field", () => {
		const items: MediaItemInput[] = [
			{
				url: "https://example.com/image.jpg",
				file_id: "AgACAgIAAxk",
				type: "image",
			},
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup).toHaveLength(1);
		expect(mediaGroup[0].media).toBe("AgACAgIAAxk");
	});

	it("uses url when file_id not available", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup).toHaveLength(1);
		expect(mediaGroup[0].media).toBe("https://example.com/image.jpg");
	});

	it("sets correct type for photos", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup[0].type).toBe("photo");
	});

	it("sets correct type and properties for videos", () => {
		const items: MediaItemInput[] = [
			{
				url: "https://example.com/video.mp4",
				type: "video",
				width: 1920,
				height: 1080,
			},
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup[0].type).toBe("video");
		expect((mediaGroup[0] as { width?: number }).width).toBe(1920);
		expect((mediaGroup[0] as { height?: number }).height).toBe(1080);
		expect(
			(mediaGroup[0] as { supports_streaming?: boolean }).supports_streaming,
		).toBe(true);
	});

	it("sets HTML parse_mode for captions", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
		];

		const mediaGroup = buildMediaGroup(items, "<b>Bold</b> caption");

		expect(mediaGroup[0].parse_mode).toBe("HTML");
	});

	it("returns empty array for empty input", () => {
		const mediaGroup = buildMediaGroup([], "Test caption");
		expect(mediaGroup).toHaveLength(0);
	});

	it("handles mixed photos and videos", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
			{ url: "https://example.com/video.mp4", type: "video" },
			{ url: "https://example.com/image2.jpg", type: "image" },
		];

		const mediaGroup = buildMediaGroup(items, "Test caption");

		expect(mediaGroup).toHaveLength(3);
		expect(mediaGroup[0].type).toBe("photo");
		expect(mediaGroup[1].type).toBe("video");
		expect(mediaGroup[2].type).toBe("photo");
	});
});

describe("getPrimaryMedia", () => {
	it("returns first non-thumbnail item", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/thumb.jpg", type: "thumbnail" },
			{ url: "https://example.com/image.jpg", type: "image" },
			{ url: "https://example.com/video.mp4", type: "video" },
		];

		const primary = getPrimaryMedia(items);

		expect(primary?.url).toBe("https://example.com/image.jpg");
		expect(primary?.type).toBe("image");
	});

	it("returns null for empty input", () => {
		const primary = getPrimaryMedia([]);
		expect(primary).toBeNull();
	});

	it("returns null when only thumbnails exist", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/thumb.jpg", type: "thumbnail" },
		];

		const primary = getPrimaryMedia(items);
		expect(primary).toBeNull();
	});
});

describe("determineSendStrategy", () => {
	it("returns text strategy when no media items", () => {
		const strategy = determineSendStrategy([]);

		expect(strategy.type).toBe("text");
		if (strategy.type === "text") {
			expect(strategy.reason).toBe("no_media");
		}
	});

	it("returns text strategy when only thumbnails", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/thumb.jpg", type: "thumbnail" },
		];

		const strategy = determineSendStrategy(items);

		expect(strategy.type).toBe("text");
	});

	it("returns single strategy for one media item", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image.jpg", type: "image" },
		];

		const strategy = determineSendStrategy(items);

		expect(strategy.type).toBe("single");
		if (strategy.type === "single") {
			expect(strategy.item.url).toBe("https://example.com/image.jpg");
		}
	});

	it("returns group strategy for multiple media items", () => {
		const items: MediaItemInput[] = [
			{ url: "https://example.com/image1.jpg", type: "image" },
			{ url: "https://example.com/image2.jpg", type: "image" },
		];

		const strategy = determineSendStrategy(items);

		expect(strategy.type).toBe("group");
		if (strategy.type === "group") {
			expect(strategy.items).toHaveLength(2);
		}
	});

	it("returns group strategy limited to MAX_MEDIA_GROUP_SIZE", () => {
		const items: MediaItemInput[] = Array.from({ length: 15 }, (_, i) => ({
			url: `https://example.com/image${i}.jpg`,
			type: "image" as const,
		}));

		const strategy = determineSendStrategy(items);

		expect(strategy.type).toBe("group");
		if (strategy.type === "group") {
			expect(strategy.items).toHaveLength(MAX_MEDIA_GROUP_SIZE);
		}
	});

	it("filters out invalid items before determining strategy", () => {
		const items: MediaItemInput[] = [
			{ type: "image" }, // No url or file_id
			{ url: "https://example.com/thumb.jpg", type: "thumbnail" },
			{ url: "https://example.com/image.jpg", type: "image" },
		];

		const strategy = determineSendStrategy(items);

		expect(strategy.type).toBe("single");
	});
});
