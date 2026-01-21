/**
 * File ID matching utilities for Telegram media items
 *
 * Handles the position-based matching between sent media items and
 * the file_ids returned from Telegram API responses.
 */

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { FileIdInfo } from "./validators/media";

/**
 * Save file_ids for media items after successful Telegram send
 *
 * This function matches file_ids to media items by position. The Telegram API
 * returns file_ids in the same order as the media items were sent, so we can
 * use array index to correlate them.
 *
 * IMPORTANT: This relies on position-based matching which is fragile.
 * The order of mediaItems and fileIds MUST correspond.
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

	// Filter to get only the media items we sent (exclude thumbnails and items without URL)
	const sentMediaItems = mediaItems.filter(
		(item) => item.type !== "thumbnail" && item.url,
	);

	for (let i = 0; i < fileIds.length; i++) {
		const fileInfo = fileIds[i];
		const mediaItem = sentMediaItems[i];
		if (fileInfo && mediaItem?.url) {
			await ctx.runMutation(
				internal.media_items.updateMediaItemWithFileIdInternal,
				{
					post_id: postId,
					url: mediaItem.url,
					file_id: fileInfo.file_id,
					file_unique_id: fileInfo.file_unique_id,
				},
			);
		}
	}
}
