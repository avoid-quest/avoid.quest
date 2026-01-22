"use node";

/**
 * Instarip Menu Middleware Export
 * Creates and exports the menu middleware for the Instarip Telegram bot
 */

import { MenuMiddleware } from "grammy-inline-menu";
import type { InstaripBotContext } from "../bot";
import { mainMenu } from "./mainMenu";

/**
 * Instarip menu middleware instance
 * Handles all inline menu interactions for Instarip app
 */
export const menuMiddleware = new MenuMiddleware<InstaripBotContext>(
	"/",
	mainMenu,
);
