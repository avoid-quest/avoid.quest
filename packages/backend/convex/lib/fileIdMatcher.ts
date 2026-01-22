/**
 * File ID matching utilities for Telegram media items
 *
 * Handles the matching between sent media items and the file_ids returned
 * from Telegram API responses. Uses position-based matching with validation
 * and file_unique_id for deduplication.
 */

import { components } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../components/instarip/_generated/dataModel";
import type { FileIdInfo } from "./validators/media";

const MAX_MEDIA_GROUP_SIZE = 10;

/**
 * Filter media items using the same logic as the Telegram mediaBuilder
 * This ensures consistency between what we send and what we try to match.
 */
function filterSentMediaItems(
	mediaItems: Doc<"media_items">[],
): Doc<"media_items">[] {
	return mediaItems
		.filter((item) => item.type !== "thumbnail")
		.filter((item) => item.file_id !== undefined)
		.slice(0, MAX_MEDIA_GROUP_SIZE);
}

/**
 * Save file_ids for media items after successful Telegram send
 *
 * This function matches file_ids to media items by position. The Telegram API
 * returns file_ids in the same order as the media items were sent, so we can
 * use array index to correlate them.
 *
 * Uses file_unique_id to validate matches when available, which helps detect
 * mismatches early.
 *
 * @param ctx - Convex action context
 * @param postId - ID of the post these media items belong to
 * @param mediaItems - Media items that were sent (from database)
 * @param fileIds - File ID info returned from Telegram (in send order)
 */
export async function saveFileIdsForPost(
	ctx: ActionCtx,
	postId: Id<"posts">,
	mediaItems: Doc<"media_items">[],
	fileIds: FileIdInfo[],
): Promise<void> {
	if (fileIds.length === 0) {
		return;
	}

	// Filter using same logic as mediaBuilder to ensure consistency
	const sentMediaItems = filterSentMediaItems(mediaItems);

	// Warn if array lengths don't match
	if (fileIds.length !== sentMediaItems.length) {
		console.warn(
			`saveFileIdsForPost: File ID count mismatch for post ${postId}: ` +
				`expected ${sentMediaItems.length} file IDs but got ${fileIds.length}. ` +
				`This may indicate an ordering issue.`,
		);
	}

	for (let i = 0; i < fileIds.length; i++) {
		const fileInfo = fileIds[i];
		const mediaItem = sentMediaItems[i];

		if (!fileInfo) {
			continue;
		}

		if (!mediaItem) {
			console.warn(
				`saveFileIdsForPost: No media item at position ${i} for post ${postId}`,
			);
			continue;
		}

		// Validate type match
		if (fileInfo.type !== mediaItem.type) {
			console.warn(
				`saveFileIdsForPost: Type mismatch at position ${i} for post ${postId}: ` +
					`expected ${mediaItem.type} but got ${fileInfo.type}`,
			);
			// Continue anyway - Telegram is the source of truth for file_id
		}

		// If media item already has a file_unique_id, validate it matches
		if (
			mediaItem.file_unique_id &&
			fileInfo.file_unique_id !== mediaItem.file_unique_id
		) {
			console.warn(
				`saveFileIdsForPost: file_unique_id mismatch at position ${i} for post ${postId}: ` +
					`existing ${mediaItem.file_unique_id} vs new ${fileInfo.file_unique_id}`,
			);
			// This is unusual but not necessarily wrong - file might have been re-uploaded
		}

		// Update by ID
		await ctx.runMutation(
			components.instarip.mediaItems.updateMediaItemFileIdById,
			{
				id: mediaItem._id,
				file_id: fileInfo.file_id,
				file_unique_id: fileInfo.file_unique_id,
			},
		);
	}
}
