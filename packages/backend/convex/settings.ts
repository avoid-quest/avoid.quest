import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getSettings = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("settings").first(),
});

export const upsertSettings = mutation({
  args: {
    id: v.optional(v.id("settings")),
    telegram: v.optional(
      v.object({
        active: v.boolean(),
        admin_chat_id: v.optional(v.string()),
        group_chat_id: v.optional(v.string()),
        cron_expression: v.optional(v.string()),
        send_limit: v.optional(v.number()),
        last_sent_at: v.optional(v.number()),
        send_report: v.boolean(),
        report_cron_expression: v.optional(v.string()),
      })
    ),
    scraper: v.optional(
      v.object({
        active: v.boolean(),
        cron_expression: v.optional(v.string()),
        limit: v.optional(v.number()),
        post_per_user: v.optional(v.number()),
        last_scraped_at: v.optional(v.number()),
      })
    ),
    logging: v.optional(
      v.object({
        active: v.boolean(),
        last_logged_at: v.optional(v.number()),
        max_retention_days: v.optional(v.number()),
        log_file: v.optional(v.string()),
        log_level: v.optional(v.string()),
      })
    ),
    ai_metadata_extraction: v.optional(
      v.object({
        enabled: v.boolean(),
        model: v.string(),
        batch_size: v.number(),
        backlog_interval_minutes: v.number(),
        max_concurrent_workflows: v.number(),
      })
    ),
  },
  handler: async (ctx, { id, telegram, scraper, logging, ai_metadata_extraction }) => {
    if (id) {
      return await ctx.db.patch(id, { telegram, scraper, logging, ai_metadata_extraction });
    }
    return await ctx.db.insert("settings", { telegram, scraper, logging, ai_metadata_extraction });
  },
});

export const updateMetadataSettings = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    model: v.optional(v.string()),
    batch_size: v.optional(v.number()),
    backlog_interval_minutes: v.optional(v.number()),
    max_concurrent_workflows: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db.query("settings").first();
    if (!settings) {
      throw new Error("Settings not found. Create settings first.");
    }

    const currentAiSettings = settings.ai_metadata_extraction ?? {
      enabled: false,
      model: "gemini-2.5-flash",
      batch_size: 10,
      backlog_interval_minutes: 5,
      max_concurrent_workflows: 1,
    };

    const updatedAiSettings = {
      ...currentAiSettings,
      ...(args.enabled !== undefined && { enabled: args.enabled }),
      ...(args.model !== undefined && { model: args.model }),
      ...(args.batch_size !== undefined && { batch_size: args.batch_size }),
      ...(args.backlog_interval_minutes !== undefined && {
        backlog_interval_minutes: args.backlog_interval_minutes,
      }),
      ...(args.max_concurrent_workflows !== undefined && {
        max_concurrent_workflows: args.max_concurrent_workflows,
      }),
    };

    await ctx.db.patch(settings._id, {
      ai_metadata_extraction: updatedAiSettings,
    });

    return updatedAiSettings;
  },
});

export const deleteSettings = mutation({
  args: { id: v.id("settings") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
