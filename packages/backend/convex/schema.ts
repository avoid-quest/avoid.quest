import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  posts: defineTable({
    ig_id: v.string(),
    shortcode: v.string(),
    display_url: v.string(),
    video_url: v.optional(v.string()),
    thumbnail_url: v.optional(v.string()),
    caption: v.string(),
    is_video: v.boolean(),
    url: v.string(),
    media_type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("carousel")
    ),
    timestamp: v.number(),
    event_date: v.optional(v.number()),
    users: v.array(v.id("users")),
    sent: v.boolean(),
    sentAt: v.optional(v.number()),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_event_date", ["event_date"])
    .index("by_shortcode", ["shortcode"])
    .index("by_user_id", ["users"])
    .index("by_sent", ["sent"]),
  media_items: defineTable({
    url: v.string(),
    type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("thumbnail")
    ),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    post_id: v.id("posts"),
  })
    .index("by_url", ["url"])
    .index("by_type", ["type"])
    .index("by_post_id", ["post_id"]),
  users: defineTable({
    username: v.string(),
    profile_url: v.optional(v.string()),
    to_be_scraped: v.boolean(),
    last_scraped_at: v.optional(v.number()),
  })
    .index("by_username", ["username"])
    .index("by_to_be_scraped_last_scraped_at", [
      "to_be_scraped",
      "last_scraped_at",
    ]),
  settings: defineTable({
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
  }),
});
