/**
 * Default configuration values for all services
 *
 * These are compile-time defaults that can be overridden by database settings.
 * Secrets (API tokens, etc.) should remain in environment variables.
 */

export const TELEGRAM_DEFAULTS = {
	/** Base URL for Telegram Bot API */
	API_BASE: "https://api.telegram.org/bot" as const,
	/** Request timeout in milliseconds */
	REQUEST_TIMEOUT_MS: 30_000,
	/** Delay between sending posts in milliseconds */
	DELAY_BETWEEN_POSTS_MS: 500,
	/** Maximum caption length for media messages */
	MAX_CAPTION_LENGTH: 1024,
	/** Maximum message length for text messages */
	MAX_MESSAGE_LENGTH: 4096,
	/** Default number of posts to send per cron run */
	SEND_LIMIT: 3,
} as const;

export const INSTAGRAM_DEFAULTS = {
	/** Base URL for Instagram API */
	API_BASE: "https://www.instagram.com/api/v1" as const,
	/** Request timeout in milliseconds */
	REQUEST_TIMEOUT_MS: 10_000,
	/** Minimum delay between scraping users in milliseconds */
	DELAY_BETWEEN_USERS_MIN_MS: 10_000,
	/** Maximum delay between scraping users in milliseconds */
	DELAY_BETWEEN_USERS_MAX_MS: 30_000,
	/** Minimum interval between scrapes for the same user in milliseconds */
	MIN_SCRAPE_INTERVAL_MS: 30 * 60 * 1000,
	/** Default number of users to scrape per cron run */
	USER_LIMIT: 5,
	/** Default number of posts to fetch per user */
	POSTS_PER_USER: 20,
	/** Rate limiter: maximum burst tokens */
	RATE_LIMIT_MAX_TOKENS: 3,
	/** Rate limiter: tokens refill rate per second */
	RATE_LIMIT_REFILL_RATE: 0.5,
} as const;

export const LOCALE_DEFAULTS = {
	/** Default timezone for date formatting */
	TIMEZONE: "Europe/Rome" as const,
	/** Default locale for date formatting */
	LOCALE: "it-IT" as const,
} as const;

export const CRON_DEFAULTS = {
	/** Telegram cron interval in minutes */
	TELEGRAM_INTERVAL_MINUTES: 30,
	/** Instagram cron interval in hours */
	INSTAGRAM_INTERVAL_HOURS: 1,
} as const;
