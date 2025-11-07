import { workflow } from "./workflow";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { extractPostMetadata } from "../ai/postMetadataExtractorAgent";
import { generateTelegramMessage } from "../ai/telegramMessageGenerator";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const processPostMetadata = workflow.define({
  args: {
    postId: workflow.arg<Id<"posts">>(),
  },
  handler: async (ctx, { postId }) => {
    const now = Date.now();

    // Step 1: Create or get metadata record (mark as "processing")
    let metadataId: Id<"post_metadata">;
    const existingMetadata = await ctx.runQuery(
      internalQuery(async (ctx) => {
        return await ctx.db
          .query("post_metadata")
          .withIndex("by_post_id", (q) => q.eq("post_id", postId))
          .first();
      })
    );

    if (existingMetadata) {
      metadataId = existingMetadata._id;
      await ctx.runMutation(
        internalMutation(async (ctx) => {
          await ctx.db.patch(metadataId, {
            processing_status: "processing",
            processing_started_at: now,
            processing_error: undefined,
          });
        })
      );
    } else {
      metadataId = await ctx.runMutation(
        internalMutation(async (ctx) => {
          return await ctx.db.insert("post_metadata", {
            post_id: postId,
            event_score: 0,
            processing_status: "processing",
            processing_started_at: now,
            extraction_version: 1,
          });
        })
      );
    }

    try {
      // Step 2: Load post data
      const post = await ctx.runQuery(
        internalQuery(async (ctx) => {
          return await ctx.db.get(postId);
        })
      );

      if (!post) {
        throw new Error(`Post with id ${postId} not found`);
      }

      // Step 3: Extract metadata via agent's asObjectAction() (with retry)
      let extractedMetadata;
      let agentThreadId: string | undefined;

      try {
        // Call the agent action from workflow
        const extractionResult = await ctx.runAction(extractPostMetadata, {
          caption: post.caption,
        });

        extractedMetadata = extractionResult.object;
        agentThreadId = extractionResult.threadId;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Metadata extraction failed: ${errorMessage}`);
      }

      // Step 4: Generate Telegram message via AI SDK action
      let telegramMessage: string | undefined;
      try {
        // Update metadata with extracted data first
        await ctx.runMutation(
          internalMutation(async (ctx) => {
            await ctx.db.patch(metadataId, {
              ...extractedMetadata,
            });
          })
        );

        // Generate Telegram message using the action
        telegramMessage = await ctx.runAction(generateTelegramMessage, {
          metadataId,
          postUrl: post.url,
        });
      } catch (error) {
        // Log error but don't fail the whole extraction
        console.error("Telegram message generation failed:", error);
      }

      // Step 5: Save metadata and link to post
      await ctx.runMutation(
        internalMutation(async (ctx) => {
          await ctx.db.patch(metadataId, {
            ...extractedMetadata,
            telegram_message: telegramMessage,
            processing_status: "completed",
            processing_completed_at: Date.now(),
            ai_model_used: "gemini-2.5-flash",
            agent_thread_id: agentThreadId,
          });

          // Link metadata to post
          await ctx.db.patch(postId, {
            metadata_id: metadataId,
          });
        })
      );

      return { success: true, metadataId };
    } catch (error) {
      // Step 6: Handle errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internalMutation(async (ctx) => {
          await ctx.db.patch(metadataId, {
            processing_status: "failed",
            processing_completed_at: Date.now(),
            processing_error: errorMessage,
          });
        })
      );

      throw error;
    }
  },
});

// Action to start the workflow (can be called from mutations)
export const startProcessPostMetadata = action({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    await processPostMetadata.start({ postId });
  },
});
