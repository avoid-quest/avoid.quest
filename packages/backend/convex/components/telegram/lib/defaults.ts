/**
 * Default configuration values for the Telegram component
 *
 * These constants are used internally by the Telegram component.
 * App-level settings (SEND_LIMIT, DELAY_BETWEEN_POSTS_MS) remain in
 * the main app's lib/config/defaults.ts as they're used by crons.ts.
 */

export const TELEGRAM_DEFAULTS = {
	/** Base URL for Telegram Bot API */
	API_BASE: "https://api.telegram.org/bot" as const,
	/** Request timeout in milliseconds */
	REQUEST_TIMEOUT_MS: 30_000,
	/** Maximum caption length for media messages */
	MAX_CAPTION_LENGTH: 1024,
	/** Maximum message length for text messages */
	MAX_MESSAGE_LENGTH: 4096,
} as const;
