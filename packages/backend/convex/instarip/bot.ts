"use node";

/**
 * Instarip Bot Factory
 * Creates and configures the Telegram bot instance for Instarip app
 */

import type { GenericActionCtx } from "convex/server";
import { Bot, type Context, type SessionFlavor, session } from "grammy";
import type { MenuMiddleware } from "grammy-inline-menu";
import type { DataModel } from "../_generated/dataModel";
import {
	createStorageAdapter,
	type SessionData,
} from "../components/telegram/lib/storageAdapter";
import { createLogger } from "../lib/logger";

const logger = createLogger("instarip:bot");

type ActionCtx = GenericActionCtx<DataModel>;

/**
 * Instarip bot context type with session data and Convex action context
 */
export type InstaripBotContext = Context &
	SessionFlavor<SessionData> & {
		/** Convex action context for database operations */
		convex: ActionCtx;
	};

/**
 * Creates and configures the grammY bot instance for Instarip
 *
 * @param token - Telegram bot token
 * @param ctx - Convex action context for database operations
 * @param menuMiddleware - Menu middleware instance (created separately)
 * @param textInputHandler - Handler for text messages (state machine)
 */
export function createInstaripBot(
	token: string,
	ctx: ActionCtx,
	menuMiddleware: MenuMiddleware<InstaripBotContext>,
	textInputHandler: (ctx: InstaripBotContext) => Promise<void>,
): Bot<InstaripBotContext> {
	const bot = new Bot<InstaripBotContext>(token);

	// Middleware to inject Convex context
	bot.use((botCtx, next) => {
		botCtx.convex = ctx;
		return next();
	});

	// Session middleware with Convex storage
	bot.use(
		session({
			initial: (): SessionData => ({}),
			storage: createStorageAdapter(ctx),
		}),
	);

	// Menu middleware - handles inline button callbacks
	bot.use(menuMiddleware.middleware());

	// Handle /start command - show main menu
	bot.command("start", async (botCtx) => {
		// Clear any pending input states
		botCtx.session.awaitingInput = undefined;
		botCtx.session.pendingDelete = undefined;
		// Send main menu
		await menuMiddleware.replyToContext(botCtx, "/");
	});

	// Handle text messages for input collection (state machine)
	bot.on("message:text", textInputHandler);

	// Error handler
	bot.catch(async (err) => {
		logger.error(`Instarip bot error: ${err.error}`);
		try {
			await err.ctx.reply("❌ Something went wrong. Please try again later.");
		} catch {
			// Ignore if we can't send the error message
		}
	});

	return bot;
}
