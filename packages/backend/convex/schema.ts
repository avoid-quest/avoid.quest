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
    metadata_id: v.optional(v.id("post_metadata")),
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
  post_metadata: defineTable({
    post_id: v.id("posts"),
    event_score: v.number(),
    event_date_start: v.optional(v.number()),
    event_date_end: v.optional(v.number()),
    event_time_start: v.optional(v.string()),
    event_time_end: v.optional(v.string()),
    location: v.optional(v.string()),
    location_address: v.optional(v.string()),
    location_coordinates: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
      })
    ),
    event_type: v.optional(
      v.union(
        v.literal("concert"),
        v.literal("workshop"),
        v.literal("conference"),
        v.literal("festival"),
        v.literal("exhibition"),
        v.literal("meetup"),
        v.literal("other")
      )
    ),
    event_title: v.optional(v.string()),
    organizer_name: v.optional(v.string()),
    organizer_contact: v.optional(v.string()),
    target_audience: v.optional(v.array(v.string())),
    registration_required: v.optional(v.boolean()),
    registration_url: v.optional(v.string()),
    ticket_price: v.optional(v.string()),
    event_description: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    content_type: v.optional(
      v.union(
        v.literal("event_announcement"),
        v.literal("event_reminder"),
        v.literal("event_recap"),
        v.literal("other")
      )
    ),
    telegram_message: v.optional(v.string()),
    processing_status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    processing_started_at: v.optional(v.number()),
    processing_completed_at: v.optional(v.number()),
    processing_error: v.optional(v.string()),
    ai_model_used: v.optional(v.string()),
    extraction_version: v.number(),
    agent_thread_id: v.optional(v.string()),
  })
    .index("by_post_id", ["post_id"])
    .index("by_event_score", ["event_score"])
    .index("by_event_date_start", ["event_date_start"])
    .index("by_processing_status", ["processing_status"])
    .index("by_event_type", ["event_type"]),
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
});
