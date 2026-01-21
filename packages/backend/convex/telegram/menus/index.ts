"use node";

/**
 * Menu Middleware Export
 * Creates and exports the menu middleware for the Telegram bot
 */

import { MenuMiddleware } from "grammy-inline-menu";
import type { BotContext } from "../bot";
import { mainMenu } from "./mainMenu";

/**
 * Menu middleware instance
 * Handles all inline menu interactions
 */
export const menuMiddleware = new MenuMiddleware<BotContext>("/", mainMenu);
