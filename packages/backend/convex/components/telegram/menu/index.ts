/**
 * Generic Menu Framework
 * Provides utilities for creating app-specific menu middleware
 */

export type {
	AppBotContext,
	BaseBotContext,
	BaseSessionData,
	MenuConfig,
	MenuHandler,
	SessionStorage,
} from "./types";

/**
 * Create a menu path for app-specific menus
 *
 * @param appId - The app identifier (e.g., "instarip")
 * @param path - The menu path within the app
 * @returns The full menu path
 */
export function createMenuPath(appId: string, path = "/"): string {
	if (path === "/") {
		return `/apps/${appId}/`;
	}
	return `/apps/${appId}${path}`;
}

/**
 * Extract app ID from a menu path
 *
 * @param path - The full menu path
 * @returns The app ID or undefined if not an app menu
 */
export function extractAppId(path: string): string | undefined {
	const match = path.match(/^\/apps\/([^/]+)/);
	return match?.[1];
}

/**
 * Check if a path is an app menu path
 *
 * @param path - The menu path to check
 * @returns True if the path is an app menu path
 */
export function isAppMenuPath(path: string): boolean {
	return path.startsWith("/apps/");
}
