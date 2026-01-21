import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { LOCALE_DEFAULTS } from "./lib/config/defaults";
import {
	instagramSettingsValidator,
	localeSettingsValidator,
	loggingSettingsValidator,
	telegramSettingsValidator,
} from "./lib/config/validators";

export const getSettings = query({
	args: {},
	handler: async (ctx) => await ctx.db.query("settings").first(),
});

export const getSettingsInternal = internalQuery({
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

export const deleteSettings = mutation({
	args: { id: v.id("settings") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

export const ensureSettings = internalMutation({
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
