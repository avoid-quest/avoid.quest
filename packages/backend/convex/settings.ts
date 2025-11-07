import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

export const getSettings = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("settings").first(),
});

export const getSettingsInternal = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      ai_metadata_extraction: v.optional(
        v.object({
          enabled: v.boolean(),
          model: v.string(),
          batch_size: v.number(),
          backlog_interval_minutes: v.number(),
          max_concurrent_workflows: v.number(),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first();
    return settings;
  },
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
  },
  handler: async (ctx, { id, telegram, scraper, logging }) => {
    if (id) {
      return await ctx.db.patch(id, { telegram, scraper, logging });
    }
    return await ctx.db.insert("settings", { telegram, scraper, logging });
  },
});

export const deleteSettings = mutation({
  args: { id: v.id("settings") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
