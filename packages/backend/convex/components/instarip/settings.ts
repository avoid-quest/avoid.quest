import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	instagramSettingsValidator,
	localeSettingsValidator,
	loggingSettingsValidator,
	telegramSettingsValidator,
} from "./schema";

/**
 * Default locale settings
 */
const LOCALE_DEFAULTS = {
	TIMEZONE: "Europe/Rome",
	LOCALE: "it-IT",
};

/**
 * Get settings
 */
export const getSettings = query({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id("settings"),
			_creationTime: v.number(),
			telegram: v.optional(telegramSettingsValidator),
			instagram: v.optional(instagramSettingsValidator),
			locale: v.optional(localeSettingsValidator),
			logging: v.optional(loggingSettingsValidator),
		}),
		v.null(),
	),
	handler: async (ctx) => {
		const settings = await ctx.db.query("settings").first();
		return settings;
	},
});

/**
 * Upsert settings
 */
export const upsertSettings = mutation({
	args: {
		id: v.optional(v.id("settings")),
		telegram: v.optional(telegramSettingsValidator),
		instagram: v.optional(instagramSettingsValidator),
		locale: v.optional(localeSettingsValidator),
		logging: v.optional(loggingSettingsValidator),
	},
	returns: v.id("settings"),
	handler: async (ctx, { id, telegram, instagram, locale, logging }) => {
		if (id) {
			await ctx.db.patch(id, {
				telegram,
				instagram,
				locale,
				logging,
			});
			return id;
		}
		return await ctx.db.insert("settings", {
			telegram,
			instagram,
			locale,
			logging,
		});
	},
});

/**
 * Delete settings
 */
export const deleteSettings = mutation({
	args: { id: v.id("settings") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Ensure settings exist (create with defaults if not)
 */
export const ensureSettings = mutation({
	args: {},
	returns: v.union(
		v.object({
			_id: v.id("settings"),
			_creationTime: v.number(),
			telegram: v.optional(telegramSettingsValidator),
			instagram: v.optional(instagramSettingsValidator),
			locale: v.optional(localeSettingsValidator),
			logging: v.optional(loggingSettingsValidator),
		}),
		v.null(),
	),
	handler: async (ctx) => {
		const existing = await ctx.db.query("settings").first();
		if (existing) {
			return existing;
		}

		const id = await ctx.db.insert("settings", {
			telegram: { active: false, send_report: false },
			instagram: { active: false },
			locale: {
				timezone: LOCALE_DEFAULTS.TIMEZONE,
				locale: LOCALE_DEFAULTS.LOCALE,
			},
			logging: { active: false },
		});

		return await ctx.db.get(id);
	},
});

/**
 * Toggle Telegram active status
 */
export const toggleTelegramActive = mutation({
	args: {},
	handler: async (ctx) => {
		const settings = await ctx.db.query("settings").first();
		if (!settings) {
			await ctx.db.insert("settings", {
				telegram: { active: true, send_report: false },
				instagram: { active: false },
				locale: {
					timezone: LOCALE_DEFAULTS.TIMEZONE,
					locale: LOCALE_DEFAULTS.LOCALE,
				},
				logging: { active: false },
			});
			return;
		}

		const currentActive = settings.telegram?.active ?? false;
		await ctx.db.patch(settings._id, {
			telegram: {
				...settings.telegram,
				active: !currentActive,
				send_report: settings.telegram?.send_report ?? false,
			},
		});
	},
});

/**
 * Toggle Telegram send_report status
 */
export const toggleTelegramReport = mutation({
	args: {},
	handler: async (ctx) => {
		const settings = await ctx.db.query("settings").first();
		if (!settings) {
			await ctx.db.insert("settings", {
				telegram: { active: false, send_report: true },
				instagram: { active: false },
				locale: {
					timezone: LOCALE_DEFAULTS.TIMEZONE,
					locale: LOCALE_DEFAULTS.LOCALE,
				},
				logging: { active: false },
			});
			return;
		}

		const currentReport = settings.telegram?.send_report ?? false;
		await ctx.db.patch(settings._id, {
			telegram: {
				...settings.telegram,
				active: settings.telegram?.active ?? false,
				send_report: !currentReport,
			},
		});
	},
});

/**
 * Toggle Instagram active status
 */
export const toggleInstagramActive = mutation({
	args: {},
	handler: async (ctx) => {
		const settings = await ctx.db.query("settings").first();
		if (!settings) {
			await ctx.db.insert("settings", {
				telegram: { active: false, send_report: false },
				instagram: { active: true },
				locale: {
					timezone: LOCALE_DEFAULTS.TIMEZONE,
					locale: LOCALE_DEFAULTS.LOCALE,
				},
				logging: { active: false },
			});
			return;
		}

		const currentActive = settings.instagram?.active ?? false;
		await ctx.db.patch(settings._id, {
			instagram: { ...settings.instagram, active: !currentActive },
		});
	},
});

/**
 * Toggle Logging active status
 */
export const toggleLoggingActive = mutation({
	args: {},
	handler: async (ctx) => {
		const settings = await ctx.db.query("settings").first();
		if (!settings) {
			await ctx.db.insert("settings", {
				telegram: { active: false, send_report: false },
				instagram: { active: false },
				locale: {
					timezone: LOCALE_DEFAULTS.TIMEZONE,
					locale: LOCALE_DEFAULTS.LOCALE,
				},
				logging: { active: true },
			});
			return;
		}

		const currentActive = settings.logging?.active ?? false;
		await ctx.db.patch(settings._id, {
			logging: { ...settings.logging, active: !currentActive },
		});
	},
});

/**
 * Valid settings sections
 */
const VALID_SETTINGS_SECTIONS = [
	"telegram",
	"instagram",
	"locale",
	"logging",
] as const;

/**
 * Update a specific setting field
 */
export const updateSetting = mutation({
	args: {
		path: v.string(),
		value: v.string(),
	},
	handler: async (ctx, { path, value }) => {
		const settings = await ctx.db.query("settings").first();
		if (!settings) {
			throw new Error("Settings not found");
		}

		const [section, field] = path.split(".") as [string, string];

		// Validate section
		if (
			!section ||
			!VALID_SETTINGS_SECTIONS.includes(
				section as (typeof VALID_SETTINGS_SECTIONS)[number],
			)
		) {
			throw new Error(
				`Invalid settings section: ${section}. Valid sections: ${VALID_SETTINGS_SECTIONS.join(", ")}`,
			);
		}

		if (!field) {
			throw new Error(`Missing field in path: ${path}`);
		}

		if (section === "telegram" && field) {
			const telegram = {
				...settings.telegram,
				active: settings.telegram?.active ?? false,
				send_report: settings.telegram?.send_report ?? false,
			};
			if (field === "group_chat_id") {
				(telegram as Record<string, unknown>)[field] = value;
			} else if (
				field === "send_limit" ||
				field === "request_timeout_ms" ||
				field === "delay_between_posts_ms"
			) {
				const num = Number.parseInt(value, 10);
				if (Number.isNaN(num)) throw new Error("Invalid number");
				(telegram as Record<string, unknown>)[field] = num;
			}
			await ctx.db.patch(settings._id, { telegram });
		} else if (section === "instagram" && field) {
			const instagram = {
				...settings.instagram,
				active: settings.instagram?.active ?? false,
			};
			if (
				field === "limit" ||
				field === "post_per_user" ||
				field === "request_timeout_ms" ||
				field === "min_scrape_interval_ms"
			) {
				const num = Number.parseInt(value, 10);
				if (Number.isNaN(num)) throw new Error("Invalid number");
				(instagram as Record<string, unknown>)[field] = num;
			}
			await ctx.db.patch(settings._id, { instagram });
		} else if (section === "locale" && field) {
			const locale = { ...settings.locale };
			if (field === "timezone" || field === "locale") {
				(locale as Record<string, unknown>)[field] = value;
			}
			await ctx.db.patch(settings._id, { locale });
		} else if (section === "logging" && field) {
			const logging = {
				...settings.logging,
				active: settings.logging?.active ?? false,
			};
			if (field === "log_level" || field === "log_file") {
				(logging as Record<string, unknown>)[field] = value;
			} else if (field === "max_retention_days") {
				const num = Number.parseInt(value, 10);
				if (Number.isNaN(num)) throw new Error("Invalid number");
				(logging as Record<string, unknown>)[field] = num;
			}
			await ctx.db.patch(settings._id, { logging });
		}
	},
});
