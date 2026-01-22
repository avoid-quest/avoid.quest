/**
 * Generic Menu Framework Types
 * Provides type definitions for app-specific menu implementations
 */

import type { Context, SessionFlavor } from "grammy";
import type { MenuTemplate } from "grammy-inline-menu";

/**
 * Generic session storage interface
 * Allows apps to implement their own session storage
 */
export interface SessionStorage<TData> {
	read(key: string): Promise<TData | undefined>;
	write(key: string, value: TData): Promise<void>;
	delete(key: string): Promise<void>;
}

/**
 * Base session data that all apps must include
 */
export interface BaseSessionData {
	/** Input awaiting state machine */
	awaitingInput?: {
		type: string;
		[key: string]: unknown;
	};
}

/**
 * Menu handler interface for app-specific menus
 */
export interface MenuHandler<TContext extends Context> {
	/** Unique identifier for this menu handler */
	id: string;
	/** Root menu template */
	rootMenu: MenuTemplate<TContext>;
	/** Optional text input handler for state machine */
	handleTextInput?: (ctx: TContext) => Promise<void>;
}

/**
 * Menu configuration for an app
 */
export interface MenuConfig<TContext extends Context> {
	/** Menu handlers for this app */
	handlers: MenuHandler<TContext>[];
	/** Admin chat ID for restricting access */
	adminChatId?: string;
}

/**
 * Generic bot context type
 * Apps extend this with their specific context requirements
 */
export type BaseBotContext<TSessionData extends BaseSessionData> = Context &
	SessionFlavor<TSessionData>;

/**
 * Type helper for creating app-specific bot contexts
 */
export type AppBotContext<
	TSessionData extends BaseSessionData,
	TAppContext = Record<string, unknown>,
> = BaseBotContext<TSessionData> & TAppContext;
