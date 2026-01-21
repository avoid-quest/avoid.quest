import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
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
