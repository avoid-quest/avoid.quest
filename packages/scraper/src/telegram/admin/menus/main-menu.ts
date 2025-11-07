import { Menu } from "@grammyjs/menu";
import type { AdminContext } from "../types";

/**
 * Main menu - root navigation menu
 */
export const mainMenu = new Menu<AdminContext>("main-menu")
  .text("👥 Users", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Reset pagination to first page
    ctx.session.usersPage = { cursor: null, page: 1 };
    const { updateUsersMenuMessage } = await import("./users-menu");
    await updateUsersMenuMessage(ctx);
  })
  .row()
  .text("📱 Posts", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Reset pagination to first page
    ctx.session.postsPage = { cursor: null, page: 1, filter: "all" };
    const { updatePostsMenuMessage } = await import("./posts-menu");
    await updatePostsMenuMessage(ctx);
  })
  .row()
  .text("⚙️ Settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { settingsMenu } = await import("./settings-menu");
    await ctx.editMessageText("⚙️ Settings\n\nSelect a section to edit:", {
      parse_mode: "HTML",
      reply_markup: settingsMenu,
    });
  })
  .row()
  .text("📊 Stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Import dynamically to avoid circular dependencies
    const { handleStatsCommand } = await import("../commands/stats");
    await handleStatsCommand(ctx);
  })
  .row()
  .text("📈 Status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleStatusCommand } = await import("../commands/status");
    await handleStatusCommand(ctx);
  });
