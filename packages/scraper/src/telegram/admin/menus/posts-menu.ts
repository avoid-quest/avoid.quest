import { Menu } from "@grammyjs/menu";
import type { Id } from "@workspace/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { api, getHttpClient } from "../../../convex/client";
import { createBot } from "../../bot";
import { sendPost } from "../../post-sender";
import type { AdminContext } from "../types";
import { escapeHtml, formatPost, navigateToMainMenu } from "../utils";
import {
  buildPaginationButtons,
  formatPaginatedList,
  getPaginationOpts,
  handlePaginationNavigation,
  ITEMS_PER_PAGE,
} from "../utils/pagination";

type PaginatedPostsResult = FunctionReturnType<
  typeof api.posts.getPostsPaginated
>;

/**
 * Update posts menu message text
 */
export async function updatePostsMenuMessage(ctx: AdminContext): Promise<void> {
  const { cursor, page, filter } = ctx.session.postsPage;
  const paginationOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);

  let result: PaginatedPostsResult;
  if (filter === "unsent") {
    result = await getHttpClient().query(api.posts.getUnsentPaginated, {
      paginationOpts,
    });
  } else {
    result = await getHttpClient().query(api.posts.getPostsPaginated, {
      paginationOpts,
    });
  }

  let postsText: string;
  if (result.page.length === 0) {
    postsText = `📱 Posts (${filter})\n\nNo posts found.`;
  } else {
    postsText = formatPaginatedList({
      items: result.page,
      currentPage: page,
      isDone: result.isDone,
      itemFormatter: (post) => {
        const p = post as {
          shortcode: string;
          sent: boolean | undefined;
          media_type: string;
        };
        const sentStatus = p.sent ? "✅" : "❌";
        return `${sentStatus} <code>${escapeHtml(p.shortcode)}</code> (${p.media_type})`;
      },
      title: `📱 Posts (${filter})`,
    });
  }

  // Use editMessageText if message exists, otherwise reply
  if (ctx.callbackQuery || ctx.message?.message_id) {
    await ctx.editMessageText(postsText, {
      parse_mode: "HTML",
      reply_markup: postsMenu,
    });
  } else {
    await ctx.reply(postsText, {
      parse_mode: "HTML",
      reply_markup: postsMenu,
    });
  }
}

/**
 * Posts menu - list posts with pagination and actions
 */
export const postsMenu = new Menu<AdminContext>("posts-menu")
  .dynamic(async (menuCtx, range) => {
    const { cursor, page, filter } = menuCtx.session.postsPage;
    const paginationOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);

    let result: PaginatedPostsResult;
    if (filter === "unsent") {
      result = await getHttpClient().query(api.posts.getUnsentPaginated, {
        paginationOpts,
      });
    } else {
      result = await getHttpClient().query(api.posts.getPostsPaginated, {
        paginationOpts,
      });
    }

    if (result.page.length === 0) {
      range.back("⬅️ Back");
      return;
    }

    // Filter buttons
    range
      .text(
        () => (filter === "all" ? "✓ All" : "All"),
        async (buttonCtx) => {
          await buttonCtx.answerCallbackQuery();
          buttonCtx.session.postsPage = {
            cursor: null,
            page: 1,
            filter: "all",
          };
          await updatePostsMenuMessage(buttonCtx);
        }
      )
      .text(
        () => (filter === "unsent" ? "✓ Unsent" : "Unsent"),
        async (buttonCtx) => {
          await buttonCtx.answerCallbackQuery();
          buttonCtx.session.postsPage = {
            cursor: null,
            page: 1,
            filter: "unsent",
          };
          await updatePostsMenuMessage(buttonCtx);
        }
      )
      .row();

    // Add post action buttons
    const MAX_SHORTCODE_DISPLAY_LENGTH = 15;
    const SHORTCODE_TRUNCATE_LENGTH = 12;
    for (const post of result.page) {
      const p = post as { shortcode: string; sent: boolean | undefined };
      const displayShortcode =
        post.shortcode.length > MAX_SHORTCODE_DISPLAY_LENGTH
          ? `${post.shortcode.substring(0, SHORTCODE_TRUNCATE_LENGTH)}...`
          : post.shortcode;
      const sentStatus = p.sent ? "✅" : "❌";
      range
        .text(`${sentStatus} ${displayShortcode}`, async (buttonCtx) => {
          await buttonCtx.answerCallbackQuery();
          const postData = await getHttpClient().query(api.posts.getPostById, {
            id: post._id,
          });
          if (!postData) {
            await buttonCtx.answerCallbackQuery({ text: "Post not found" });
            return;
          }
          const postText = formatPost(postData);
          buttonCtx.session.pendingInput = {
            type: "post_view",
            section: "",
            key: post._id,
          };
          await buttonCtx.reply(postText, {
            parse_mode: "HTML",
            reply_markup: postDetailMenu,
          });
        })
        .row();
    }

    // Add pagination buttons with handlers
    buildPaginationButtons({
      range,
      hasPrev: page > 1,
      hasNext: !result.isDone,
      onPrev:
        page > 1
          ? async (buttonCtx) => {
              await buttonCtx.answerCallbackQuery();
              const {
                cursor: currentCursor,
                page: currentPage,
                filter: currentFilter,
              } = buttonCtx.session.postsPage;
              const currentOpts = getPaginationOpts(
                currentCursor,
                ITEMS_PER_PAGE
              );
              let currentResult: PaginatedPostsResult;
              if (currentFilter === "unsent") {
                currentResult = await getHttpClient().query(
                  api.posts.getUnsentPaginated,
                  { paginationOpts: currentOpts }
                );
              } else {
                currentResult = await getHttpClient().query(
                  api.posts.getPostsPaginated,
                  { paginationOpts: currentOpts }
                );
              }
              const newState = handlePaginationNavigation({
                action: "prev",
                currentCursor,
                currentPage,
                continueCursor: currentResult.continueCursor,
                isDone: currentResult.isDone,
              });
              buttonCtx.session.postsPage = {
                ...newState,
                filter: currentFilter,
              };
              await updatePostsMenuMessage(buttonCtx);
            }
          : undefined,
      onNext: result.isDone
        ? undefined
        : async (buttonCtx) => {
            await buttonCtx.answerCallbackQuery();
            const {
              cursor: currentCursor,
              page: currentPage,
              filter: currentFilter,
            } = buttonCtx.session.postsPage;
            const currentOpts = getPaginationOpts(
              currentCursor,
              ITEMS_PER_PAGE
            );
            let currentResult: PaginatedPostsResult;
            if (currentFilter === "unsent") {
              currentResult = await getHttpClient().query(
                api.posts.getUnsentPaginated,
                { paginationOpts: currentOpts }
              );
            } else {
              currentResult = await getHttpClient().query(
                api.posts.getPostsPaginated,
                { paginationOpts: currentOpts }
              );
            }
            const newState = handlePaginationNavigation({
              action: "next",
              currentCursor,
              currentPage,
              continueCursor: currentResult.continueCursor,
              isDone: currentResult.isDone,
            });
            buttonCtx.session.postsPage = {
              ...newState,
              filter: currentFilter,
            };
            await updatePostsMenuMessage(buttonCtx);
          },
    });

    range.row();
    range.text("🏠 Home", async (buttonCtx) => {
      await buttonCtx.answerCallbackQuery();
      await navigateToMainMenu(buttonCtx);
    });
    range.back("⬅️ Back");
  })
  .text(/^post:view:(.+)$/, async (ctx) => {
    const postId = ctx.match[1];
    const post = await getHttpClient().query(api.posts.getPostById, {
      id: postId as Id<"posts">,
    });

    if (!post) {
      await ctx.answerCallbackQuery({ text: "Post not found" });
      return;
    }

    await ctx.answerCallbackQuery();

    const postText = formatPost(post);

    // Store post ID in session
    ctx.session.pendingInput = {
      type: "post_view",
      section: "",
      key: postId,
    };

    await ctx.reply(postText, {
      parse_mode: "HTML",
      reply_markup: postDetailMenu,
    });
  })
  .text(/^posts:page:(prev|next)$/, async (ctx) => {
    const action = ctx.match[1];
    const { cursor, page, filter } = ctx.session.postsPage;

    // Get current page to determine continueCursor
    const currentOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);
    let currentResult: PaginatedPostsResult;
    if (filter === "unsent") {
      currentResult = await getHttpClient().query(
        api.posts.getUnsentPaginated,
        { paginationOpts: currentOpts }
      );
    } else {
      currentResult = await getHttpClient().query(api.posts.getPostsPaginated, {
        paginationOpts: currentOpts,
      });
    }

    const newState = handlePaginationNavigation({
      action,
      currentCursor: cursor,
      currentPage: page,
      continueCursor: currentResult.continueCursor,
      isDone: currentResult.isDone,
    });

    // Update session state first
    ctx.session.postsPage = {
      ...newState,
      filter,
    };
    await ctx.answerCallbackQuery();

    // Update message text and menu - editMessageText with menu will trigger dynamic builder
    await updatePostsMenuMessage(ctx);
  })
  .text(/^posts:filter:(all|unsent)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const newFilter = ctx.match[1] as "all" | "unsent";
    ctx.session.postsPage = {
      cursor: null,
      page: 1,
      filter: newFilter,
    };
    // Update message text and menu - editMessageText with menu will trigger dynamic builder
    await updatePostsMenuMessage(ctx);
  });

/**
 * Post detail menu
 */
export const postDetailMenu = new Menu<AdminContext>("post-detail-menu")
  .text("👁️ Preview", async (ctx) => {
    const postId = ctx.session.pendingInput?.key;
    if (!postId) {
      await ctx.answerCallbackQuery({ text: "Post ID not found" });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: postId as Id<"posts">,
    });

    if (!post) {
      await ctx.answerCallbackQuery({ text: "Post not found" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Sending preview..." });

    const bot = createBot();
    if (!bot) {
      await ctx.reply("❌ Bot not available", { parse_mode: "HTML" });
      return;
    }

    const adminChatId = ctx.adminChatId;
    if (!adminChatId) {
      await ctx.reply("❌ Admin chat ID not available", { parse_mode: "HTML" });
      return;
    }

    try {
      await sendPost(bot, adminChatId, post, ctx.logger);
      await ctx.reply(
        "✅ Preview sent! (Note: This was a preview and was NOT marked as sent in the database)",
        { parse_mode: "HTML" }
      );
    } catch (error) {
      ctx.logger.error(
        `Error sending preview: ${error instanceof Error ? error.message : String(error)}`
      );
      await ctx.reply(
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        { parse_mode: "HTML" }
      );
    }
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  })
  .back("⬅️ Back");
