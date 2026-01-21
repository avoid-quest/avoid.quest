/**
 * Shared Convex validators for settings
 *
 * These validators are used both in schema.ts and settings.ts to ensure
 * consistency and avoid duplication.
 */

import type { Infer } from "convex/values";
import { v } from "convex/values";

/**
 * Telegram settings validator
 * Used in schema and settings mutations
 */
export const telegramSettingsValidator = v.object({
	active: v.boolean(),
	group_chat_id: v.optional(v.string()),
	send_limit: v.optional(v.number()),
	send_report: v.boolean(),
	// Runtime-configurable timeouts/delays
	request_timeout_ms: v.optional(v.number()),
	delay_between_posts_ms: v.optional(v.number()),
});

/**
 * Instagram settings validator
 * Used in schema and settings mutations
 */
export const instagramSettingsValidator = v.object({
	active: v.boolean(),
	limit: v.optional(v.number()),
	post_per_user: v.optional(v.number()),
	// Runtime-configurable timeouts/delays
	request_timeout_ms: v.optional(v.number()),
	min_scrape_interval_ms: v.optional(v.number()),
	delay_between_users_min_ms: v.optional(v.number()),
	delay_between_users_max_ms: v.optional(v.number()),
	rate_limit_max_tokens: v.optional(v.number()),
	rate_limit_refill_rate: v.optional(v.number()),
});

/**
 * Locale settings validator
 * Used for timezone and locale configuration
 */
export const localeSettingsValidator = v.object({
	timezone: v.optional(v.string()),
	locale: v.optional(v.string()),
});

/**
 * Logging settings validator
 * Used in schema and settings mutations
 */
export const loggingSettingsValidator = v.object({
	active: v.boolean(),
	max_retention_days: v.optional(v.number()),
	log_file: v.optional(v.string()),
	log_level: v.optional(v.string()),
});

// Inferred types for TypeScript usage
export type TelegramSettings = Infer<typeof telegramSettingsValidator>;
export type InstagramSettings = Infer<typeof instagramSettingsValidator>;
export type LocaleSettings = Infer<typeof localeSettingsValidator>;
export type LoggingSettings = Infer<typeof loggingSettingsValidator>;
