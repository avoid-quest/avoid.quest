/**
 * Centralized configuration module
 *
 * This module provides:
 * 1. Default values (compile-time constants)
 * 2. Shared validators (for schema and settings)
 * 3. Resolver functions (merge defaults with database settings)
 *
 * Configuration layering:
 * - defaults.ts (compile-time) -> database (runtime) -> env vars (secrets only)
 */

import {
	INSTAGRAM_DEFAULTS,
	LOCALE_DEFAULTS,
	TELEGRAM_DEFAULTS,
} from "./defaults";

// Re-export defaults and validators
export {
	CRON_DEFAULTS,
	INSTAGRAM_DEFAULTS,
	LOCALE_DEFAULTS,
	TELEGRAM_DEFAULTS,
} from "./defaults";
export {
	instagramSettingsValidator,
	localeSettingsValidator,
	loggingSettingsValidator,
	telegramSettingsValidator,
} from "./validators";

/**
 * Database settings type (matches schema)
 */
type TelegramDbSettings = {
	active: boolean;
	admin_chat_id?: string;
	group_chat_id?: string;
	send_limit?: number;
	last_sent_at?: number;
	send_report: boolean;
	request_timeout_ms?: number;
	delay_between_posts_ms?: number;
};

type InstagramDbSettings = {
	active: boolean;
	limit?: number;
	post_per_user?: number;
	last_scraped_at?: number;
	request_timeout_ms?: number;
	min_scrape_interval_ms?: number;
	delay_between_users_min_ms?: number;
	delay_between_users_max_ms?: number;
	rate_limit_max_tokens?: number;
	rate_limit_refill_rate?: number;
};

type LocaleDbSettings = {
	timezone?: string;
	locale?: string;
};

/**
 * Resolved configuration types (all values present)
 */
export type ResolvedTelegramConfig = {
	active: boolean;
	adminChatId?: string;
	groupChatId?: string;
	sendLimit: number;
	lastSentAt?: number;
	sendReport: boolean;
	requestTimeoutMs: number;
	delayBetweenPostsMs: number;
};

export type ResolvedInstagramConfig = {
	active: boolean;
	userLimit: number;
	postsPerUser: number;
	lastScrapedAt?: number;
	requestTimeoutMs: number;
	minScrapeIntervalMs: number;
	delayBetweenUsersMinMs: number;
	delayBetweenUsersMaxMs: number;
	rateLimitMaxTokens: number;
	rateLimitRefillRate: number;
};

export type ResolvedLocaleConfig = {
	timezone: string;
	locale: string;
};

export type ResolvedConfig = {
	telegram: ResolvedTelegramConfig;
	instagram: ResolvedInstagramConfig;
	locale: ResolvedLocaleConfig;
};

/**
 * Resolve Telegram configuration
 * Merges database settings with defaults
 */
export function resolveTelegramConfig(
	dbSettings?: TelegramDbSettings | null,
): ResolvedTelegramConfig {
	return {
		active: dbSettings?.active ?? false,
		adminChatId: dbSettings?.admin_chat_id,
		groupChatId: dbSettings?.group_chat_id,
		sendLimit: dbSettings?.send_limit ?? TELEGRAM_DEFAULTS.SEND_LIMIT,
		lastSentAt: dbSettings?.last_sent_at,
		sendReport: dbSettings?.send_report ?? false,
		requestTimeoutMs:
			dbSettings?.request_timeout_ms ?? TELEGRAM_DEFAULTS.REQUEST_TIMEOUT_MS,
		delayBetweenPostsMs:
			dbSettings?.delay_between_posts_ms ??
			TELEGRAM_DEFAULTS.DELAY_BETWEEN_POSTS_MS,
	};
}

/**
 * Resolve Instagram configuration
 * Merges database settings with defaults
 */
export function resolveInstagramConfig(
	dbSettings?: InstagramDbSettings | null,
): ResolvedInstagramConfig {
	return {
		active: dbSettings?.active ?? false,
		userLimit: dbSettings?.limit ?? INSTAGRAM_DEFAULTS.USER_LIMIT,
		postsPerUser:
			dbSettings?.post_per_user ?? INSTAGRAM_DEFAULTS.POSTS_PER_USER,
		lastScrapedAt: dbSettings?.last_scraped_at,
		requestTimeoutMs:
			dbSettings?.request_timeout_ms ?? INSTAGRAM_DEFAULTS.REQUEST_TIMEOUT_MS,
		minScrapeIntervalMs:
			dbSettings?.min_scrape_interval_ms ??
			INSTAGRAM_DEFAULTS.MIN_SCRAPE_INTERVAL_MS,
		delayBetweenUsersMinMs:
			dbSettings?.delay_between_users_min_ms ??
			INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MIN_MS,
		delayBetweenUsersMaxMs:
			dbSettings?.delay_between_users_max_ms ??
			INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MAX_MS,
		rateLimitMaxTokens:
			dbSettings?.rate_limit_max_tokens ??
			INSTAGRAM_DEFAULTS.RATE_LIMIT_MAX_TOKENS,
		rateLimitRefillRate:
			dbSettings?.rate_limit_refill_rate ??
			INSTAGRAM_DEFAULTS.RATE_LIMIT_REFILL_RATE,
	};
}

/**
 * Resolve locale configuration
 * Merges database settings with defaults
 */
export function resolveLocaleConfig(
	dbSettings?: LocaleDbSettings | null,
): ResolvedLocaleConfig {
	return {
		timezone: dbSettings?.timezone ?? LOCALE_DEFAULTS.TIMEZONE,
		locale: dbSettings?.locale ?? LOCALE_DEFAULTS.LOCALE,
	};
}

/**
 * Resolve all configuration
 * Main entry point for getting resolved config from database settings
 */
export function resolveConfig(
	dbSettings?: {
		telegram?: TelegramDbSettings | null;
		instagram?: InstagramDbSettings | null;
		locale?: LocaleDbSettings | null;
	} | null,
): ResolvedConfig {
	return {
		telegram: resolveTelegramConfig(dbSettings?.telegram),
		instagram: resolveInstagramConfig(dbSettings?.instagram),
		locale: resolveLocaleConfig(dbSettings?.locale),
	};
}

/**
 * Get random delay between users for Instagram scraping
 * Uses min/max from config
 */
export function getRandomDelayBetweenUsers(
	config: ResolvedInstagramConfig,
): number {
	const range = config.delayBetweenUsersMaxMs - config.delayBetweenUsersMinMs;
	return config.delayBetweenUsersMinMs + Math.floor(Math.random() * range);
}
