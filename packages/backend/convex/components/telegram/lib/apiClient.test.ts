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
