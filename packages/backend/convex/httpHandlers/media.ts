import { components } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { createLogger } from "../lib/logger";
import { isOriginAllowed } from "../lib/security";

const logger = createLogger("media:proxy");

type TelegramFileResponse = {
	ok: boolean;
	result?: { file_path?: string };
	description?: string;
};

const MEDIA_FETCH_TIMEOUT_MS = 10000;

/**
 * Allowed origins for media endpoint
 * Includes localhost for development and configurable production domains
 */
function getAllowedOrigins(): string[] {
	const origins = ["http://localhost:3000", "http://localhost:5173"];
	const configuredOrigin = process.env.ALLOWED_MEDIA_ORIGIN;
	if (configuredOrigin) {
		origins.push(configuredOrigin);
	}
	return origins;
}

/**
 * Create a response with CORS headers
 */
function corsResponse(
	body: BodyInit | null,
	init: ResponseInit,
	origin: string | null,
): Response {
	const headers = new Headers(init.headers);
	headers.set("Access-Control-Allow-Origin", origin ?? "*");
	return new Response(body, { ...init, headers });
}

export const mediaHandler = httpAction(async (ctx, request) => {
	// Origin validation for cross-origin requests
	const origin = request.headers.get("Origin");
	if (!isOriginAllowed(origin, getAllowedOrigins())) {
		return new Response("Forbidden", { status: 403 });
	}

	// Handle OPTIONS preflight requests
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": origin ?? "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Max-Age": "86400",
			},
		});
	}

	const { searchParams } = new URL(request.url);
	const mediaId = searchParams.get("id");

	if (!mediaId) {
		return corsResponse("Missing media id", { status: 400 }, origin);
	}

	// Get media item from database via component
	const mediaItem = await ctx.runQuery(
		components.instarip.mediaItems.getMediaItemById,
		{
			id: mediaId as never,
		},
	);

	if (!mediaItem) {
		return corsResponse("Media not found", { status: 404 }, origin);
	}

	if (!mediaItem.telegram_file?.file_id) {
		return corsResponse(
			"Media not yet uploaded to Telegram",
			{ status: 404 },
			origin,
		);
	}

	// Get Telegram download URL
	const botToken = process.env.TELEGRAM_BOT_TOKEN;
	if (!botToken) {
		return corsResponse("Server configuration error", { status: 500 }, origin);
	}

	// Create AbortController for timeout handling
	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(),
		MEDIA_FETCH_TIMEOUT_MS,
	);

	try {
		const getFileResponse = await fetch(
			`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(mediaItem.telegram_file.file_id)}`,
			{ signal: controller.signal },
		);
		const fileInfo = (await getFileResponse.json()) as TelegramFileResponse;

		if (!fileInfo.ok || !fileInfo.result?.file_path) {
			logger.error(
				`Telegram getFile failed - file_id: ${mediaItem.telegram_file.file_id}, type: ${mediaItem.type}, error: ${fileInfo.description}`,
			);
			return corsResponse(
				"Failed to get file from Telegram",
				{ status: 502 },
				origin,
			);
		}

		// Fetch the actual file from Telegram CDN
		const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
		const fileResponse = await fetch(fileUrl, { signal: controller.signal });

		if (!fileResponse.ok) {
			return corsResponse(
				"Failed to download file from Telegram",
				{ status: 502 },
				origin,
			);
		}

		// Determine content type based on media type
		const contentTypeMap: Record<string, string> = {
			image: "image/jpeg",
			video: "video/mp4",
			thumbnail: "image/jpeg",
		};
		const contentType =
			contentTypeMap[mediaItem.type] || "application/octet-stream";

		// Return with aggressive caching headers
		// immutable = browser will NEVER revalidate, just use cache
		return new Response(fileResponse.body, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=31536000, immutable",
				"Access-Control-Allow-Origin": origin ?? "*",
			},
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return corsResponse("Request timeout", { status: 504 }, origin);
		}
		logger.error(
			`Media fetch failed - file_id: ${mediaItem.telegram_file?.file_id}, type: ${mediaItem.type}, error: ${error instanceof Error ? error.message : "Unknown"}`,
		);
		return corsResponse("Internal server error", { status: 500 }, origin);
	} finally {
		clearTimeout(timeoutId);
	}
});
