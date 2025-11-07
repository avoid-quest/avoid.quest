import { Menu } from "@grammyjs/menu";
import type { Id } from "@workspace/backend/convex/_generated/dataModel";
import { api, getHttpClient } from "../../../convex/client";
import type { AdminContext } from "../types";
import { escapeHtml, formatUser, navigateToMainMenu } from "../utils";
import {
  buildPaginationButtons,
  formatPaginatedList,
  getPaginationOpts,
  handlePaginationNavigation,
  ITEMS_PER_PAGE,
} from "../utils/pagination";

/**
 * Update users menu message text
 */
export async function updateUsersMenuMessage(ctx: AdminContext): Promise<void> {
  const { cursor, page } = ctx.session.usersPage;
  const paginationOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);

  const result = await getHttpClient().query(api.users.getUsersPaginated, {
    paginationOpts,
  });

  let userText: string;
  if (result.page.length === 0) {
    userText = "👥 Users\n\nNo users found.";
  } else {
    userText = formatPaginatedList({
      items: result.page,
      currentPage: page,
      isDone: result.isDone,
      itemFormatter: (user) => {
        const u = user as { username: string; to_be_scraped: boolean };
        return `<code>${escapeHtml(u.username)}</code> - ${u.to_be_scraped ? "✅" : "❌"}`;
      },
      title: "👥 Users",
    });
  }

  // Use editMessageText if message exists, otherwise reply
  if (ctx.callbackQuery || ctx.message?.message_id) {
    await ctx.editMessageText(userText, {
      parse_mode: "HTML",
      reply_markup: usersMenu,
    });
  } else {
    await ctx.reply(userText, {
      parse_mode: "HTML",
      reply_markup: usersMenu,
    });
  }
}

/**
 * Users menu - list users with pagination and actions
 */
export const usersMenu = new Menu<AdminContext>("users-menu")
  .dynamic(async (menuCtx, range) => {
    const { cursor, page } = menuCtx.session.usersPage;
    const paginationOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);

    const result = await getHttpClient().query(api.users.getUsersPaginated, {
      paginationOpts,
    });

    if (result.page.length === 0) {
      range.back("⬅️ Back");
      return;
    }

    // Add user action buttons
    const MAX_USERNAME_DISPLAY_LENGTH = 20;
    const USERNAME_TRUNCATE_LENGTH = 17;
    for (const user of result.page) {
      const displayName =
        user.username.length > MAX_USERNAME_DISPLAY_LENGTH
          ? `${user.username.substring(0, USERNAME_TRUNCATE_LENGTH)}...`
          : user.username;
      range
        .text(
          `${user.to_be_scraped ? "✅" : "❌"} ${displayName}`,
          async (buttonCtx) => {
            await buttonCtx.answerCallbackQuery();
            const userData = await getHttpClient().query(
              api.users.getUserById,
              {
                id: user._id,
              }
            );
            if (!userData) {
              await buttonCtx.answerCallbackQuery({ text: "User not found" });
              return;
            }
            const userText = formatUser(userData);
            buttonCtx.session.pendingInput = {
              type: "user_delete",
              section: "",
              key: user._id,
            };
            await buttonCtx.reply(userText, {
              parse_mode: "HTML",
              reply_markup: userDetailMenu,
            });
          }
        )
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
              const { cursor: currentCursor, page: currentPage } =
                buttonCtx.session.usersPage;
              const currentOpts = getPaginationOpts(
                currentCursor,
                ITEMS_PER_PAGE
              );
              const currentResult = await getHttpClient().query(
                api.users.getUsersPaginated,
                { paginationOpts: currentOpts }
              );
              const newState = handlePaginationNavigation({
                action: "prev",
                currentCursor,
                currentPage,
                continueCursor: currentResult.continueCursor,
                isDone: currentResult.isDone,
              });
              buttonCtx.session.usersPage = newState;
              await updateUsersMenuMessage(buttonCtx);
            }
          : undefined,
      onNext: result.isDone
        ? undefined
        : async (buttonCtx) => {
            await buttonCtx.answerCallbackQuery();
            const { cursor: currentCursor, page: currentPage } =
              buttonCtx.session.usersPage;
            const currentOpts = getPaginationOpts(
              currentCursor,
              ITEMS_PER_PAGE
            );
            const currentResult = await getHttpClient().query(
              api.users.getUsersPaginated,
              { paginationOpts: currentOpts }
            );
            const newState = handlePaginationNavigation({
              action: "next",
              currentCursor,
              currentPage,
              continueCursor: currentResult.continueCursor,
              isDone: currentResult.isDone,
            });
            buttonCtx.session.usersPage = newState;
            await updateUsersMenuMessage(buttonCtx);
          },
    });

    range.row();
    range.text("🏠 Home", async (buttonCtx) => {
      await buttonCtx.answerCallbackQuery();
      await navigateToMainMenu(buttonCtx);
    });
    range.back("⬅️ Back");
  })
  .text(/^user:view:(.+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const user = await getHttpClient().query(api.users.getUserById, {
      id: userId as Id<"users">,
    });

    if (!user) {
      await ctx.answerCallbackQuery({ text: "User not found" });
      return;
    }

    await ctx.answerCallbackQuery();

    const userText = formatUser(user);

    // Store user ID in session for delete confirmation
    ctx.session.pendingInput = {
      type: "user_delete",
      section: "",
      key: userId,
    };

    await ctx.reply(userText, {
      parse_mode: "HTML",
      reply_markup: userDetailMenu,
    });
  })
  .text(/^users:page:(prev|next)$/, async (ctx) => {
    const action = ctx.match[1];
    const { cursor, page } = ctx.session.usersPage;

    // Get current page to determine continueCursor
    const currentOpts = getPaginationOpts(cursor, ITEMS_PER_PAGE);
    const currentResult = await getHttpClient().query(
      api.users.getUsersPaginated,
      { paginationOpts: currentOpts }
    );

    const newState = handlePaginationNavigation({
      action,
      currentCursor: cursor,
      currentPage: page,
      continueCursor: currentResult.continueCursor,
      isDone: currentResult.isDone,
    });

    // Update session state first
    ctx.session.usersPage = newState;
    await ctx.answerCallbackQuery();

    // Update message text and menu - editMessageText with menu will trigger dynamic builder
    await updateUsersMenuMessage(ctx);
  });

/**
 * User detail menu
 */
export const userDetailMenu = new Menu<AdminContext>("user-detail-menu")
  .text(
    (_ctx) => {
      // We need to get user from session or fetch it
      return "Toggle Status";
    },
    async (ctx) => {
      const userId = ctx.session.pendingInput?.key;
      if (!userId) {
        await ctx.answerCallbackQuery({ text: "User ID not found" });
        return;
      }

      const user = await getHttpClient().query(api.users.getUserById, {
        id: userId as Id<"users">,
      });

      if (!user) {
        await ctx.answerCallbackQuery({ text: "User not found" });
        return;
      }

      const newValue = !user.to_be_scraped;
      await getHttpClient().mutation(api.users.upsertUser, {
        id: user._id,
        to_be_scraped: newValue,
      });

      await ctx.answerCallbackQuery({
        text: `User ${newValue ? "enabled" : "disabled"}`,
      });

      // Update the message with new user data
      const userText = formatUser({
        ...user,
        to_be_scraped: newValue,
      });

      await ctx.editMessageText(userText, {
        parse_mode: "HTML",
        reply_markup: userDetailMenu,
      });
    }
  )
  .row()
  .text("🗑️ Delete", async (ctx) => {
    await ctx.menu.nav("user-delete-confirm-menu");
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  })
  .back("⬅️ Back");

/**
 * User delete confirmation menu
 */
export const userDeleteConfirmMenu = new Menu<AdminContext>(
  "user-delete-confirm-menu"
)
  .text("✅ Confirm Delete", async (ctx) => {
    const userId = ctx.session.pendingInput?.key;
    if (!userId) {
      await ctx.answerCallbackQuery({ text: "User ID not found" });
      return;
    }

    await getHttpClient().mutation(api.users.deleteUser, {
      id: userId as Id<"users">,
    });

    await ctx.answerCallbackQuery({ text: "User deleted" });
    await ctx.deleteMessage();

    // Reset pagination to first page and show users menu
    ctx.session.usersPage = { cursor: null, page: 1 };
    await updateUsersMenuMessage(ctx);
  })
  .row()
  .text("❌ Cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.menu.back();
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  });
