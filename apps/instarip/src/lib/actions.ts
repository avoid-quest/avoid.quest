"use server";

import {
  getMediaItemByPostId,
  getVirtualPostsByUserId,
  getVirtualPostsWithUsernames,
} from "./queries";
import type {
  MediaItem,
  Post,
  VirtualScrollParams,
  VirtualScrollResult,
} from "./types";

// Virtual scrolling actions for infinite loading
export async function getVirtualPostsWithMediaAction(
  params: VirtualScrollParams = {}
): Promise<
  VirtualScrollResult<Post & { mediaItems?: MediaItem[]; username: string }>
> {
  const postsResult = await getVirtualPostsWithUsernames(params);

  // Fetch media items for carousel posts
  const postsWithMedia = await Promise.all(
    postsResult.data.map(async (post: Post & { username: string }) => {
      if (post.media_type === "carousel") {
        const mediaItems = await getMediaItemByPostId(post.int_id);
        return { ...post, mediaItems };
      }
      return post;
    })
  );

  return {
    ...postsResult,
    data: postsWithMedia,
  };
}

export async function getVirtualUserPostsWithMediaAction(
  userId: number,
  params: VirtualScrollParams = {}
): Promise<
  VirtualScrollResult<Post & { mediaItems?: MediaItem[]; username: string }>
> {
  const postsResult = await getVirtualPostsByUserId(userId, params);

  // Fetch media items for carousel posts
  const postsWithMedia = await Promise.all(
    postsResult.data.map(async (post: Post & { username: string }) => {
      if (post.media_type === "carousel") {
        const mediaItems = await getMediaItemByPostId(post.int_id);
        return { ...post, mediaItems };
      }
      return post;
    })
  );

  return {
    ...postsResult,
    data: postsWithMedia,
  };
}
