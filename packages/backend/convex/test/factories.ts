/**
 * Test data factories for generating test fixtures
 */

import type { Id } from "../_generated/dataModel";

/**
 * Create a mock post ID for testing
 */
export function createMockPostId(): Id<"posts"> {
	return `posts:${Date.now()}_${Math.random().toString(36).slice(2)}` as Id<"posts">;
}

/**
 * Create a mock user ID for testing
 */
export function createMockUserId(): Id<"users"> {
	return `users:${Date.now()}_${Math.random().toString(36).slice(2)}` as Id<"users">;
}

/**
 * Create a mock media item ID for testing
 */
export function createMockMediaItemId(): Id<"media_items"> {
	return `media_items:${Date.now()}_${Math.random().toString(36).slice(2)}` as Id<"media_items">;
}

/**
 * Post factory for test data
 */
export function createTestPost(overrides?: Partial<TestPost>): TestPost {
	const now = Date.now();
	return {
		ig_id: `post_${now}`,
		shortcode: `ABC${now.toString(36).toUpperCase()}`,
		display_url: `https://instagram.com/p/test/${now}`,
		caption: "Test caption",
		is_video: false,
		url: `https://instagram.com/p/test_${now}/`,
		media_type: "image",
		timestamp: now,
		users: [],
		sent: false,
		...overrides,
	};
}

type TestPost = {
	ig_id: string;
	shortcode: string;
	display_url: string;
	caption: string;
	is_video: boolean;
	url: string;
	media_type: "image" | "video" | "carousel";
	timestamp: number;
	event_date?: number;
	users: Id<"users">[];
	sent: boolean;
	sentAt?: number;
	video_url?: string;
	thumbnail_url?: string;
};

/**
 * User factory for test data
 */
export function createTestUser(overrides?: Partial<TestUser>): TestUser {
	const now = Date.now();
	return {
		username: `testuser_${now}`,
		to_be_scraped: true,
		...overrides,
	};
}

type TestUser = {
	username: string;
	profile_url?: string;
	to_be_scraped: boolean;
	last_scraped_at?: number;
};

/**
 * Media item factory for test data
 */
export function createTestMediaItem(
	overrides?: Partial<TestMediaItem>,
): TestMediaItem {
	const now = Date.now();
	return {
		url: `https://instagram.com/media/${now}.jpg`,
		type: "image",
		post_id: createMockPostId(),
		...overrides,
	};
}

type TestMediaItem = {
	url?: string;
	file_id?: string;
	file_unique_id?: string;
	type: "image" | "video" | "thumbnail";
	width?: number;
	height?: number;
	post_id: Id<"posts">;
};

/**
 * Settings factory for test data
 */
export function createTestSettings(
	overrides?: Partial<TestSettings>,
): TestSettings {
	return {
		telegram: {
			active: false,
			send_report: false,
		},
		instagram: {
			active: false,
		},
		locale: {
			timezone: "Europe/Rome",
			locale: "it-IT",
		},
		logging: {
			active: false,
		},
		...overrides,
	};
}

type TestSettings = {
	telegram?: {
		active: boolean;
		group_chat_id?: string;
		send_limit?: number;
		send_report: boolean;
		request_timeout_ms?: number;
		delay_between_posts_ms?: number;
	};
	instagram?: {
		active: boolean;
		limit?: number;
		post_per_user?: number;
		request_timeout_ms?: number;
		min_scrape_interval_ms?: number;
	};
	locale?: {
		timezone?: string;
		locale?: string;
	};
	logging?: {
		active: boolean;
		max_retention_days?: number;
		log_level?: string;
	};
};

/**
 * Telegram API response factory
 */
export function createTelegramSuccessResponse<T>(result: T) {
	return { ok: true as const, result };
}

export function createTelegramErrorResponse(
	error_code: number,
	description: string,
	parameters?: { retry_after?: number },
) {
	return { ok: false as const, error_code, description, parameters };
}

/**
 * Create a media item with Telegram file_id (migrated item)
 */
export function createTestMediaItemWithFileId(
	overrides?: Partial<TestMediaItem>,
): TestMediaItem {
	const uniqueId =
		Date.now().toString(36) + Math.random().toString(36).slice(2);
	return {
		file_id: `AgACAgIAAxk${uniqueId}`,
		file_unique_id: `AQADAgAT${uniqueId.slice(0, 16)}`,
		type: "image",
		post_id: createMockPostId(),
		width: 1080,
		height: 1080,
		...overrides,
	};
}

/**
 * Create a legacy media item with only URL (needs backfill)
 */
export function createTestMediaItemUrlOnly(
	overrides?: Partial<TestMediaItem>,
): TestMediaItem {
	const now = Date.now();
	return {
		url: `https://instagram.com/media/${now}.jpg`,
		type: "image",
		post_id: createMockPostId(),
		width: 1080,
		height: 1080,
		...overrides,
	};
}

/**
 * Create file_id info as returned from Telegram sender
 */
export function createFileIdInfo(
	overrides?: Partial<TestFileIdInfo>,
): TestFileIdInfo {
	const uniqueId =
		Date.now().toString(36) + Math.random().toString(36).slice(2);
	return {
		file_id: `AgACAgIAAxk${uniqueId}`,
		file_unique_id: `AQADAgAT${uniqueId.slice(0, 16)}`,
		type: "image",
		...overrides,
	};
}

type TestFileIdInfo = {
	file_id: string;
	file_unique_id: string;
	type: "image" | "video";
};

/**
 * Create a mock Telegram message response with photo
 */
export function createTelegramPhotoMessage(
	messageId: number,
	overrides?: { fileId?: string; fileUniqueId?: string },
) {
	const uniqueId =
		Date.now().toString(36) + Math.random().toString(36).slice(2);
	return {
		message_id: messageId,
		chat: { id: -1001234567890, type: "supergroup" as const },
		date: Math.floor(Date.now() / 1000),
		photo: [
			{
				file_id: overrides?.fileId ?? `AgACAgIAAxksmall${uniqueId}`,
				file_unique_id:
					overrides?.fileUniqueId ?? `AQADsmall${uniqueId.slice(0, 12)}`,
				width: 320,
				height: 320,
				file_size: 10000,
			},
			{
				file_id: overrides?.fileId ?? `AgACAgIAAxkmed${uniqueId}`,
				file_unique_id:
					overrides?.fileUniqueId ?? `AQADmed${uniqueId.slice(0, 12)}`,
				width: 800,
				height: 800,
				file_size: 50000,
			},
			{
				file_id: overrides?.fileId ?? `AgACAgIAAxk${uniqueId}`,
				file_unique_id:
					overrides?.fileUniqueId ?? `AQADAgAT${uniqueId.slice(0, 12)}`,
				width: 1280,
				height: 1280,
				file_size: 100000,
			},
		],
	};
}

/**
 * Create a mock Telegram message response with video
 */
export function createTelegramVideoMessage(
	messageId: number,
	overrides?: { fileId?: string; fileUniqueId?: string },
) {
	const uniqueId =
		Date.now().toString(36) + Math.random().toString(36).slice(2);
	return {
		message_id: messageId,
		chat: { id: -1001234567890, type: "supergroup" as const },
		date: Math.floor(Date.now() / 1000),
		video: {
			file_id: overrides?.fileId ?? `BAACAgIAAxk${uniqueId}`,
			file_unique_id:
				overrides?.fileUniqueId ?? `AQADBAATvid${uniqueId.slice(0, 10)}`,
			width: 1920,
			height: 1080,
			duration: 30,
			file_size: 5000000,
		},
	};
}

/**
 * Create a mock Telegram media group response (array of messages)
 */
export function createTelegramMediaGroupResponse(
	startMessageId: number,
	items: Array<{ type: "photo" | "video" }>,
) {
	return items.map((item, index) => {
		const messageId = startMessageId + index;
		if (item.type === "video") {
			return createTelegramVideoMessage(messageId);
		}
		return createTelegramPhotoMessage(messageId);
	});
}
