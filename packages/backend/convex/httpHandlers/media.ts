import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";

type TelegramFileResponse = {
	ok: boolean;
	result?: { file_path?: string };
	description?: string;
};

export const mediaHandler = httpAction(async (ctx, request) => {
	const { searchParams } = new URL(request.url);
	const mediaId = searchParams.get("id");

	if (!mediaId) {
		return new Response("Missing media id", { status: 400 });
	}

	// Get media item from database
	const mediaItem = await ctx.runQuery(internal.media_items.getMediaItemById, {
		id: mediaId as Id<"media_items">,
	});

	if (!mediaItem) {
		return new Response("Media not found", { status: 404 });
	}

	if (!mediaItem.file_id) {
		return new Response("Media not yet uploaded to Telegram", { status: 404 });
	}

	// Get Telegram download URL
	const botToken = process.env.TELEGRAM_BOT_TOKEN;
	if (!botToken) {
		return new Response("Server configuration error", { status: 500 });
	}

	const getFileResponse = await fetch(
		`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(mediaItem.file_id)}`,
	);
	const fileInfo = (await getFileResponse.json()) as TelegramFileResponse;

	if (!fileInfo.ok || !fileInfo.result?.file_path) {
		console.error("Telegram getFile failed:", fileInfo.description);
		return new Response("Failed to get file from Telegram", { status: 502 });
	}

	// Fetch the actual file from Telegram CDN
	const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
	const fileResponse = await fetch(fileUrl);

	if (!fileResponse.ok) {
		return new Response("Failed to download file from Telegram", {
			status: 502,
		});
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
		},
	});
});
