/**
 * Fetch-based Telegram Bot API client for Convex actions
 * Uses native fetch instead of grammy since we're in a serverless context
 */

import { TELEGRAM_DEFAULTS } from "./defaults";

export type TelegramApiError = {
	ok: false;
	error_code: number;
	description: string;
	parameters?: {
		retry_after?: number;
		migrate_to_chat_id?: number;
	};
};

export type TelegramApiSuccess<T> = {
	ok: true;
	result: T;
};

export type TelegramApiResponse<T> = TelegramApiSuccess<T> | TelegramApiError;

export type InputMediaPhoto = {
	type: "photo";
	media: string;
	caption?: string;
	parse_mode?: "HTML" | "MarkdownV2";
};

export type InputMediaVideo = {
	type: "video";
	media: string;
	caption?: string;
	parse_mode?: "HTML" | "MarkdownV2";
	width?: number;
	height?: number;
	supports_streaming?: boolean;
};

export type InputMedia = InputMediaPhoto | InputMediaVideo;

export type Message = {
	message_id: number;
	chat: { id: number };
	date: number;
	text?: string;
	photo?: Array<{ file_id: string; file_unique_id: string }>;
	video?: { file_id: string; file_unique_id: string };
};

export type SendMessageParams = {
	chat_id: string | number;
	text: string;
	parse_mode?: "HTML" | "MarkdownV2";
	disable_web_page_preview?: boolean;
	disable_notification?: boolean;
};

export type SendMediaGroupParams = {
	chat_id: string | number;
	media: InputMedia[];
	disable_notification?: boolean;
};

export type SendPhotoParams = {
	chat_id: string | number;
	photo: string;
	caption?: string;
	parse_mode?: "HTML" | "MarkdownV2";
	disable_notification?: boolean;
};

export type SendVideoParams = {
	chat_id: string | number;
	video: string;
	caption?: string;
	parse_mode?: "HTML" | "MarkdownV2";
	width?: number;
	height?: number;
	supports_streaming?: boolean;
	disable_notification?: boolean;
};

export type TelegramClientOptions = {
	requestTimeoutMs?: number;
};

export function createTelegramClient(
	botToken: string,
	options?: TelegramClientOptions,
) {
	const baseUrl = `${TELEGRAM_DEFAULTS.API_BASE}${botToken}`;
	const requestTimeoutMs =
		options?.requestTimeoutMs ?? TELEGRAM_DEFAULTS.REQUEST_TIMEOUT_MS;

	async function callApi<T>(
		method: string,
		params: Record<string, unknown>,
	): Promise<TelegramApiResponse<T>> {
		const url = `${baseUrl}/${method}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(params),
				signal: controller.signal,
			});

			try {
				const data = (await response.json()) as TelegramApiResponse<T>;
				return data;
			} catch (parseError) {
				// Handle JSON parse errors (can occur during Telegram outages)
				return {
					ok: false,
					error_code: 0,
					description: `JSON parse error: ${parseError instanceof Error ? parseError.message : "Unknown parse error"}`,
				};
			}
		} catch (error) {
			// Handle AbortError (timeout) and network errors
			if (error instanceof Error && error.name === "AbortError") {
				return { ok: false, error_code: 408, description: "Request timeout" };
			}
			return {
				ok: false,
				error_code: 0,
				description: error instanceof Error ? error.message : "Network error",
			};
		} finally {
			clearTimeout(timeoutId);
		}
	}

	return {
		async sendMessage(
			params: SendMessageParams,
		): Promise<TelegramApiResponse<Message>> {
			return callApi<Message>("sendMessage", params);
		},

		async sendMediaGroup(
			params: SendMediaGroupParams,
		): Promise<TelegramApiResponse<Message[]>> {
			return callApi<Message[]>("sendMediaGroup", params);
		},

		async sendPhoto(
			params: SendPhotoParams,
		): Promise<TelegramApiResponse<Message>> {
			return callApi<Message>("sendPhoto", params);
		},

		async sendVideo(
			params: SendVideoParams,
		): Promise<TelegramApiResponse<Message>> {
			return callApi<Message>("sendVideo", params);
		},

		async getMe(): Promise<
			TelegramApiResponse<{ id: number; username: string }>
		> {
			return callApi("getMe", {});
		},
	};
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;

/**
 * Check if response is an error
 */
export function isApiError<T>(
	response: TelegramApiResponse<T>,
): response is TelegramApiError {
	return !response.ok;
}

/**
 * Check if error is rate-limited
 */
export function isRateLimited(error: TelegramApiError): boolean {
	return error.error_code === 429;
}

/**
 * Get retry-after delay in milliseconds
 */
export function getRetryAfterMs(error: TelegramApiError): number | undefined {
	if (error.parameters?.retry_after) {
		return error.parameters.retry_after * 1000;
	}
	return undefined;
}

/**
 * Check if error is recoverable (should retry)
 */
export function isRecoverableError(error: TelegramApiError): boolean {
	// Rate limited - retry after delay
	if (error.error_code === 429) return true;
	// Server errors - retry
	if (error.error_code >= 500) return true;
	// Bad gateway, service unavailable
	if ([502, 503, 504].includes(error.error_code)) return true;
	return false;
}

/**
 * Check if error is permanent (don't retry)
 */
export function isPermanentError(error: TelegramApiError): boolean {
	// Bad request - malformed data
	if (error.error_code === 400) return true;
	// Unauthorized - invalid token
	if (error.error_code === 401) return true;
	// Forbidden - bot blocked or kicked
	if (error.error_code === 403) return true;
	// Not found - chat doesn't exist
	if (error.error_code === 404) return true;
	return false;
}
