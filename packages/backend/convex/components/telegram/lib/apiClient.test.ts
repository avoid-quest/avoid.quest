/**
 * Tests for Telegram API client utilities
 */

import { describe, expect, it } from "vitest";
import {
	getRetryAfterMs,
	isApiError,
	isPermanentError,
	isRateLimited,
	isRecoverableError,
	type TelegramApiError,
	type TelegramApiResponse,
} from "./apiClient";

describe("isApiError", () => {
	it("returns true for error response", () => {
		const response: TelegramApiResponse<unknown> = {
			ok: false,
			error_code: 400,
			description: "Bad Request",
		};

		expect(isApiError(response)).toBe(true);
	});

	it("returns false for success response", () => {
		const response: TelegramApiResponse<{ id: number }> = {
			ok: true,
			result: { id: 123 },
		};

		expect(isApiError(response)).toBe(false);
	});
});

describe("isRateLimited", () => {
	it("returns true for 429 error", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
			parameters: { retry_after: 60 },
		};

		expect(isRateLimited(error)).toBe(true);
	});

	it("returns false for other errors", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 400,
			description: "Bad Request",
		};

		expect(isRateLimited(error)).toBe(false);
	});
});

describe("getRetryAfterMs", () => {
	it("returns retry_after in milliseconds", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
			parameters: { retry_after: 30 },
		};

		expect(getRetryAfterMs(error)).toBe(30000);
	});

	it("returns undefined when no retry_after", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
		};

		expect(getRetryAfterMs(error)).toBeUndefined();
	});

	it("returns undefined when no parameters", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 400,
			description: "Bad Request",
		};

		expect(getRetryAfterMs(error)).toBeUndefined();
	});
});

describe("isRecoverableError", () => {
	it("returns true for rate limited (429)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
		};

		expect(isRecoverableError(error)).toBe(true);
	});

	it("returns true for server error (500)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 500,
			description: "Internal Server Error",
		};

		expect(isRecoverableError(error)).toBe(true);
	});

	it("returns true for bad gateway (502)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 502,
			description: "Bad Gateway",
		};

		expect(isRecoverableError(error)).toBe(true);
	});

	it("returns true for service unavailable (503)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 503,
			description: "Service Unavailable",
		};

		expect(isRecoverableError(error)).toBe(true);
	});

	it("returns true for gateway timeout (504)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 504,
			description: "Gateway Timeout",
		};

		expect(isRecoverableError(error)).toBe(true);
	});

	it("returns false for client errors", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 400,
			description: "Bad Request",
		};

		expect(isRecoverableError(error)).toBe(false);
	});
});

describe("isPermanentError", () => {
	it("returns true for bad request (400)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 400,
			description: "Bad Request: chat not found",
		};

		expect(isPermanentError(error)).toBe(true);
	});

	it("returns true for unauthorized (401)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 401,
			description: "Unauthorized",
		};

		expect(isPermanentError(error)).toBe(true);
	});

	it("returns true for forbidden (403)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 403,
			description: "Forbidden: bot was blocked by the user",
		};

		expect(isPermanentError(error)).toBe(true);
	});

	it("returns true for not found (404)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 404,
			description: "Not Found",
		};

		expect(isPermanentError(error)).toBe(true);
	});

	it("returns false for rate limited (429)", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
		};

		expect(isPermanentError(error)).toBe(false);
	});

	it("returns false for server errors", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 500,
			description: "Internal Server Error",
		};

		expect(isPermanentError(error)).toBe(false);
	});
});

describe("error classification completeness", () => {
	it("classifies errors as either recoverable or permanent", () => {
		// Common error codes should be classified
		const errorCodes = [400, 401, 403, 404, 429, 500, 502, 503, 504];

		for (const code of errorCodes) {
			const error: TelegramApiError = {
				ok: false,
				error_code: code,
				description: `Error ${code}`,
			};

			const isRecoverable = isRecoverableError(error);
			const isPermanent = isPermanentError(error);

			// Each error should be either recoverable or permanent (XOR)
			expect(
				isRecoverable !== isPermanent,
				`Error ${code} should be classified as either recoverable or permanent`,
			).toBe(true);
		}
	});

	it("handles unknown error codes", () => {
		const error: TelegramApiError = {
			ok: false,
			error_code: 418, // I'm a teapot
			description: "Unknown error",
		};

		// Unknown errors should not be classified as either
		expect(isRecoverableError(error)).toBe(false);
		expect(isPermanentError(error)).toBe(false);
	});
});

/**
 * Tests for file_id extraction from Telegram API responses
 * These tests document the expected structure of Telegram responses
 */
describe("file_id extraction from API responses", () => {
	// Helper types matching Telegram API response structure
	type PhotoSize = {
		file_id: string;
		file_unique_id: string;
		width: number;
		height: number;
		file_size?: number;
	};

	type VideoInfo = {
		file_id: string;
		file_unique_id: string;
		width: number;
		height: number;
		duration: number;
		file_size?: number;
	};

	type TelegramMessage = {
		message_id: number;
		photo?: PhotoSize[];
		video?: VideoInfo;
	};

	function extractLargestPhoto(photos: PhotoSize[]): PhotoSize | null {
		if (!photos || photos.length === 0) return null;
		// Telegram orders photos from smallest to largest
		return photos[photos.length - 1];
	}

	function extractFileIdsFromMediaGroup(messages: TelegramMessage[]): Array<{
		file_id: string;
		file_unique_id: string;
		type: "image" | "video";
	}> {
		const fileIds: Array<{
			file_id: string;
			file_unique_id: string;
			type: "image" | "video";
		}> = [];

		for (const msg of messages) {
			if (msg.photo && msg.photo.length > 0) {
				const largest = extractLargestPhoto(msg.photo);
				if (largest) {
					fileIds.push({
						file_id: largest.file_id,
						file_unique_id: largest.file_unique_id,
						type: "image",
					});
				}
			} else if (msg.video) {
				fileIds.push({
					file_id: msg.video.file_id,
					file_unique_id: msg.video.file_unique_id,
					type: "video",
				});
			}
		}

		return fileIds;
	}

	it("extracts largest photo from multiple sizes", () => {
		const photos: PhotoSize[] = [
			{
				file_id: "AgACSmall",
				file_unique_id: "uniqueSmall",
				width: 320,
				height: 320,
				file_size: 10000,
			},
			{
				file_id: "AgACMedium",
				file_unique_id: "uniqueMedium",
				width: 800,
				height: 800,
				file_size: 50000,
			},
			{
				file_id: "AgACLarge",
				file_unique_id: "uniqueLarge",
				width: 1280,
				height: 1280,
				file_size: 100000,
			},
		];

		const largest = extractLargestPhoto(photos);

		expect(largest?.file_id).toBe("AgACLarge");
		expect(largest?.file_unique_id).toBe("uniqueLarge");
		expect(largest?.width).toBe(1280);
	});

	it("handles empty photo array", () => {
		const largest = extractLargestPhoto([]);
		expect(largest).toBeNull();
	});

	it("handles single photo size", () => {
		const photos: PhotoSize[] = [
			{
				file_id: "AgACOnly",
				file_unique_id: "uniqueOnly",
				width: 800,
				height: 600,
			},
		];

		const largest = extractLargestPhoto(photos);

		expect(largest?.file_id).toBe("AgACOnly");
	});

	it("extracts video file_id directly", () => {
		const video: VideoInfo = {
			file_id: "BAACVideo",
			file_unique_id: "uniqueVideo",
			width: 1920,
			height: 1080,
			duration: 30,
			file_size: 5000000,
		};

		expect(video.file_id).toBe("BAACVideo");
		expect(video.file_unique_id).toBe("uniqueVideo");
	});

	it("extracts file_ids from media group in order", () => {
		const messages: TelegramMessage[] = [
			{
				message_id: 1,
				photo: [
					{
						file_id: "AgAC1Small",
						file_unique_id: "unique1s",
						width: 320,
						height: 320,
					},
					{
						file_id: "AgAC1Large",
						file_unique_id: "unique1l",
						width: 1280,
						height: 1280,
					},
				],
			},
			{
				message_id: 2,
				video: {
					file_id: "BAACVideo",
					file_unique_id: "uniqueVid",
					width: 1920,
					height: 1080,
					duration: 30,
				},
			},
			{
				message_id: 3,
				photo: [
					{
						file_id: "AgAC3Large",
						file_unique_id: "unique3l",
						width: 1280,
						height: 1280,
					},
				],
			},
		];

		const fileIds = extractFileIdsFromMediaGroup(messages);

		expect(fileIds).toHaveLength(3);
		// First message - photo, should get largest
		expect(fileIds[0].file_id).toBe("AgAC1Large");
		expect(fileIds[0].type).toBe("image");
		// Second message - video
		expect(fileIds[1].file_id).toBe("BAACVideo");
		expect(fileIds[1].type).toBe("video");
		// Third message - photo
		expect(fileIds[2].file_id).toBe("AgAC3Large");
		expect(fileIds[2].type).toBe("image");
	});

	it("handles media group response order matches send order", () => {
		// Telegram returns messages in the same order they were sent
		// This is critical for position-based matching
		const messages: TelegramMessage[] = [
			{
				message_id: 100,
				photo: [
					{ file_id: "A", file_unique_id: "uA", width: 100, height: 100 },
				],
			},
			{
				message_id: 101,
				photo: [
					{ file_id: "B", file_unique_id: "uB", width: 100, height: 100 },
				],
			},
			{
				message_id: 102,
				photo: [
					{ file_id: "C", file_unique_id: "uC", width: 100, height: 100 },
				],
			},
		];

		const fileIds = extractFileIdsFromMediaGroup(messages);

		// Order should be preserved: A, B, C
		expect(fileIds[0].file_id).toBe("A");
		expect(fileIds[1].file_id).toBe("B");
		expect(fileIds[2].file_id).toBe("C");
	});

	it("handles missing file_id gracefully", () => {
		const messages: TelegramMessage[] = [
			{
				message_id: 1,
				photo: [
					{
						file_id: "AgAC1",
						file_unique_id: "unique1",
						width: 1280,
						height: 1280,
					},
				],
			},
			{
				message_id: 2,
				// No photo or video - shouldn't happen but handle gracefully
			},
			{
				message_id: 3,
				photo: [
					{
						file_id: "AgAC3",
						file_unique_id: "unique3",
						width: 1280,
						height: 1280,
					},
				],
			},
		];

		const fileIds = extractFileIdsFromMediaGroup(messages);

		// Should only have 2 entries, skipping the empty message
		expect(fileIds).toHaveLength(2);
		expect(fileIds[0].file_id).toBe("AgAC1");
		expect(fileIds[1].file_id).toBe("AgAC3");
	});

	it("handles video with thumbnail correctly", () => {
		// Videos in Telegram can have thumbnail photos, but we want the video file_id
		const message: TelegramMessage = {
			message_id: 1,
			video: {
				file_id: "BAACMainVideo",
				file_unique_id: "uniqueMainVideo",
				width: 1920,
				height: 1080,
				duration: 60,
			},
			// Note: thumbnails are in a separate 'thumb' field, not in 'photo'
		};

		const fileIds = extractFileIdsFromMediaGroup([message]);

		expect(fileIds).toHaveLength(1);
		expect(fileIds[0].file_id).toBe("BAACMainVideo");
		expect(fileIds[0].type).toBe("video");
	});
});
