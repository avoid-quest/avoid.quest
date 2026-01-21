/**
 * Bootstrap action to initialize default data.
 * Idempotent - safe to call multiple times.
 *
 * Usage:
 * - Deploy preview: npx convex deploy --preview-run "bootstrap"
 * - Manual: npx convex run bootstrap
 * - Dashboard: Navigate to Functions → bootstrap → Run
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

export const bootstrap = action({
	args: {},
	returns: v.object({
		initialized: v.boolean(),
		settingsId: v.optional(v.id("settings")),
	}),
	handler: async (
		ctx,
	): Promise<{ initialized: boolean; settingsId?: Id<"settings"> }> => {
		const settings = await ctx.runMutation(internal.settings.ensureSettings);
		return {
			initialized: true,
			settingsId: settings?._id,
		};
	},
});
