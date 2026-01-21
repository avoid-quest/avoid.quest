/**
 * HTTP router for Convex
 * Handles external webhook requests
 */

import type { GenericActionCtx } from "convex/server";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";

type ActionCtx = GenericActionCtx<DataModel>;

const http = httpRouter();

/**
 * Telegram Update type (simplified)
 */
type TelegramUpdate = {
	update_id: number;
	message?: {
		message_id: number;
		from?: { id: number };
		chat: { id: number };
		text?: string;
	};
	callback_query?: {
		id: string;
		from: { id: number };
		message?: { chat: { id: number } };
		data?: string;
	};
};

/**
 * Parse command from message text
 */
function parseCommand(text: string): { command: string; args: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;
	const parts = trimmed.split(/\s+/);
	const firstPart = parts[0];
	if (!firstPart) return null;
	const command = firstPart.toLowerCase().split("@")[0];
	if (!command) return null;
	const args = parts.slice(1).join(" ");
	return { command, args };
}

/**
 * Send a message via Telegram API
 */
async function sendMessage(
	botToken: string,
	chatId: string,
	text: string,
): Promise<void> {
	await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			parse_mode: "HTML",
		}),
	});
}

/**
 * Telegram webhook endpoint
 * Receives updates from Telegram Bot API
 */
http.route({
	path: "/telegram/webhook",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return new Response("Bot token not configured", { status: 500 });
		}

		// Verify webhook secret (mandatory for security)
		const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
		const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
		if (!expectedSecret) {
			return new Response("TELEGRAM_WEBHOOK_SECRET not configured", {
				status: 500,
			});
		}
		if (secret !== expectedSecret) {
			return new Response("Unauthorized", { status: 401 });
		}

		try {
			const update = (await request.json()) as TelegramUpdate;
			const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

			// Get chat ID from message or callback
			const chatId =
				update.message?.chat.id.toString() ??
				update.callback_query?.message?.chat.id.toString();

			if (!chatId) {
				return new Response("OK", { status: 200 });
			}

			// Check admin authorization
			if (adminChatId && chatId !== adminChatId) {
				return new Response("OK", { status: 200 });
			}

			// Handle callback queries
			if (update.callback_query) {
				await fetch(
					`https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							callback_query_id: update.callback_query.id,
						}),
					},
				);

				const data = update.callback_query.data;
				if (data === "trigger_instagram") {
					await handleTriggerInstagram(ctx, botToken, chatId);
				} else if (data === "trigger_telegram") {
					await handleTriggerTelegram(ctx, botToken, chatId);
				}
				return new Response("OK", { status: 200 });
			}

			// Handle text messages
			if (update.message?.text) {
				const parsed = parseCommand(update.message.text);
				if (!parsed) {
					return new Response("OK", { status: 200 });
				}

				switch (parsed.command) {
					case "/start":
					case "/help":
						await sendMessage(botToken, chatId, getHelpMessage());
						break;

					case "/status":
						await handleStatus(ctx, botToken, chatId);
						break;

					case "/stats":
						await handleStats(ctx, botToken, chatId);
						break;

					case "/trigger":
						await handleTrigger(ctx, botToken, chatId, parsed.args);
						break;

					case "/post":
						await handlePost(ctx, botToken, chatId, parsed.args);
						break;
				}
			}

			return new Response("OK", { status: 200 });
		} catch (_error) {
			// Error handling: return OK to prevent Telegram from retrying
			// The webhook should not expose internal errors
			return new Response("OK", { status: 200 });
		}
	}),
});

function getHelpMessage(): string {
	return `<b>🤖 Instagram Bot Admin</b>

<b>📊 Status & Stats</b>
/status - Show system status
/stats - Show database statistics

<b>🔄 Triggers</b>
/trigger instagram - Run Instagram fetch
/trigger telegram - Run Telegram send

<b>📸 Posts</b>
/post add &lt;url&gt; - Fetch and save a post
/post preview &lt;url&gt; - Preview a post

/help - Show this message`;
}

async function handleStatus(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
): Promise<void> {
	try {
		const settings = (await ctx.runQuery(
			internal.settings.getSettingsInternal,
			{},
		)) as {
			telegram?: {
				active: boolean;
				group_chat_id?: string;
				send_limit?: number;
				last_sent_at?: number;
			};
			instagram?: {
				active: boolean;
				limit?: number;
				post_per_user?: number;
				last_scraped_at?: number;
			};
		} | null;

		if (!settings) {
			await sendMessage(botToken, chatId, "⚠️ No settings found.");
			return;
		}

		const telegramStatus = settings.telegram?.active
			? "✅ Active"
			: "❌ Inactive";
		const instagramStatus = settings.instagram?.active
			? "✅ Active"
			: "❌ Inactive";
		const lastSentAt = settings.telegram?.last_sent_at
			? new Date(settings.telegram.last_sent_at).toLocaleString()
			: "Never";
		const lastScrapedAt = settings.instagram?.last_scraped_at
			? new Date(settings.instagram.last_scraped_at).toLocaleString()
			: "Never";

		await sendMessage(
			botToken,
			chatId,
			`<b>📊 System Status</b>

<b>📱 Telegram</b>
Status: ${telegramStatus}
Group: ${settings.telegram?.group_chat_id ?? "Not set"}
Limit: ${settings.telegram?.send_limit ?? 3}
Last Sent: ${lastSentAt}

<b>📸 Instagram</b>
Status: ${instagramStatus}
Users: ${settings.instagram?.limit ?? 5}
Posts/User: ${settings.instagram?.post_per_user ?? 20}
Last Scraped: ${lastScrapedAt}`,
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await sendMessage(botToken, chatId, `❌ Error: ${msg}`);
	}
}

async function handleStats(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
): Promise<void> {
	try {
		const unsent = await ctx.runQuery(internal.posts.getUnsentInternal, {
			limit: 1000,
		});
		const users = await ctx.runQuery(internal.users.listToBeScrapedInternal, {
			limit: 1000,
		});

		await sendMessage(
			botToken,
			chatId,
			`<b>📊 Database Statistics</b>

<b>📱 Posts</b>
Unsent: ${unsent.length}

<b>👥 Users</b>
Active: ${users.length}`,
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await sendMessage(botToken, chatId, `❌ Error: ${msg}`);
	}
}

async function handleTrigger(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
	args: string,
): Promise<void> {
	const job = args.toLowerCase().trim();

	if (job === "instagram") {
		await handleTriggerInstagram(ctx, botToken, chatId);
	} else if (job === "telegram") {
		await handleTriggerTelegram(ctx, botToken, chatId);
	} else {
		await sendMessage(
			botToken,
			chatId,
			"⚠️ Usage: /trigger instagram or /trigger telegram",
		);
	}
}

async function handleTriggerInstagram(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
): Promise<void> {
	await sendMessage(botToken, chatId, "⏳ Triggering Instagram fetch...");

	try {
		const result = (await ctx.runAction(
			internal.crons.runInstagramFetch,
			{},
		)) as {
			skipped?: boolean;
			usersProcessed?: number;
			newPosts?: number;
			errors?: string[];
		};

		if (result.skipped) {
			await sendMessage(botToken, chatId, "⏭️ Skipped (inactive)");
			return;
		}

		let text = `✅ <b>Instagram Fetch Complete</b>
Users: ${result.usersProcessed ?? 0}
New Posts: ${result.newPosts ?? 0}`;

		if (result.errors?.length) {
			text += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join("\n")}`;
		}

		await sendMessage(botToken, chatId, text);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await sendMessage(botToken, chatId, `❌ Failed: ${msg}`);
	}
}

async function handleTriggerTelegram(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
): Promise<void> {
	await sendMessage(botToken, chatId, "⏳ Triggering Telegram send...");

	try {
		const result = (await ctx.runAction(
			internal.crons.runTelegramSend,
			{},
		)) as {
			skipped?: boolean;
			sent?: number;
			failed?: number;
			errors?: string[];
		};

		if (result.skipped) {
			await sendMessage(botToken, chatId, "⏭️ Skipped (inactive)");
			return;
		}

		let text = `✅ <b>Telegram Send Complete</b>
Sent: ${result.sent ?? 0}
Failed: ${result.failed ?? 0}`;

		if (result.errors?.length) {
			text += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join("\n")}`;
		}

		await sendMessage(botToken, chatId, text);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await sendMessage(botToken, chatId, `❌ Failed: ${msg}`);
	}
}

async function handlePost(
	ctx: ActionCtx,
	botToken: string,
	chatId: string,
	args: string,
): Promise<void> {
	const parts = args.trim().split(/\s+/);
	const subcommand = parts[0]?.toLowerCase();
	const url = parts[1];

	if (!subcommand || !url) {
		await sendMessage(
			botToken,
			chatId,
			"⚠️ Usage: /post add <url> or /post preview <url>",
		);
		return;
	}

	if (subcommand !== "add" && subcommand !== "preview") {
		await sendMessage(
			botToken,
			chatId,
			"⚠️ Usage: /post add <url> or /post preview <url>",
		);
		return;
	}

	// Validate Instagram URL more strictly
	try {
		const parsedUrl = new URL(url);
		if (!parsedUrl.hostname.endsWith("instagram.com")) {
			await sendMessage(botToken, chatId, "⚠️ Invalid Instagram URL");
			return;
		}
	} catch {
		await sendMessage(botToken, chatId, "⚠️ Invalid URL format");
		return;
	}

	try {
		const result = (await ctx.runAction(
			components.instagram.fetcher.fetchPost,
			{
				postUrl: url,
			},
		)) as {
			success: boolean;
			post?: {
				id: string;
				shortcode: string;
				timestampSec: number;
				display_url: string;
				caption: string;
				is_video: boolean;
				url: string;
				media_type: "image" | "video" | "carousel";
				media_items: Array<{
					url: string;
					type: "image" | "video" | "thumbnail";
					width?: number;
					height?: number;
				}>;
				video_url?: string;
				thumbnail_url?: string;
			};
			error?: string;
		};

		if (!result.success || !result.post) {
			await sendMessage(
				botToken,
				chatId,
				`❌ Failed: ${result.error ?? "Unknown"}`,
			);
			return;
		}

		const post = result.post;

		// If "add" subcommand, save the post to database
		if (subcommand === "add") {
			// Convert timestamp from seconds to milliseconds
			const timestampMs = post.timestampSec * 1000;

			// Upsert the post (empty users array for manually added posts)
			const postId = await ctx.runMutation(internal.posts.upsertPostInternal, {
				ig_id: post.id,
				shortcode: post.shortcode,
				display_url: post.display_url,
				video_url: post.video_url,
				thumbnail_url: post.thumbnail_url,
				caption: post.caption,
				is_video: post.is_video,
				url: post.url,
				media_type: post.media_type,
				users: [],
				timestamp: timestampMs,
			});

			// Sync media items
			await ctx.runMutation(
				internal.media_items.syncMediaItemsForPostInternal,
				{
					post_id: postId,
					media_items: post.media_items,
				},
			);

			const caption =
				post.caption.length > 80
					? `${post.caption.slice(0, 80)}...`
					: post.caption;

			await sendMessage(
				botToken,
				chatId,
				`<b>✅ Post Saved</b>

ID: ${post.shortcode}
Type: ${post.media_type}
Media: ${post.media_items.length} items
Caption: ${caption}`,
			);
			return;
		}

		// Preview subcommand - just show info
		const caption =
			post.caption.length > 80
				? `${post.caption.slice(0, 80)}...`
				: post.caption;

		await sendMessage(
			botToken,
			chatId,
			`<b>📸 Post Preview</b>

ID: ${post.shortcode}
Type: ${post.media_type}
Media: ${post.media_items.length} items
Caption: ${caption}`,
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await sendMessage(botToken, chatId, `❌ Error: ${msg}`);
	}
}

/**
 * Health check endpoint
 */
http.route({
	path: "/health",
	method: "GET",
	handler: httpAction(async () => {
		return new Response(JSON.stringify({ status: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}),
});

export default http;
