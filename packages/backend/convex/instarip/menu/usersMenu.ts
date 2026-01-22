"use node";

/**
 * Instarip Users Menu Template
 * Manage Instagram users (add, view, edit, delete)
 */

import { MenuTemplate } from "grammy-inline-menu";
import { components } from "../../_generated/api";
import type { InstaripBotContext } from "../bot";

/**
 * User detail submenu
 */
const userDetailMenu = new MenuTemplate<InstaripBotContext>(async (ctx) => {
	const userId = ctx.match?.[1];
	if (!userId)
		return { text: "❌ User not found", parse_mode: "HTML" as const };

	const user = await ctx.convex.runQuery(
		components.instarip.users.getUserById,
		{
			id: userId as never,
		},
	);

	if (!user) return { text: "❌ User not found", parse_mode: "HTML" as const };

	const scrapingStatus = user.to_be_scraped ? "✅ Active" : "❌ Inactive";
	const lastScraped = user.last_scraped_at
		? new Date(user.last_scraped_at).toLocaleString()
		: "Never";

	return {
		text: `<b>👤 @${user.username}</b>

Scraping: ${scrapingStatus}
Last Scraped: ${lastScraped}`,
		parse_mode: "HTML" as const,
	};
});

/**
 * Toggle scraping status
 */
userDetailMenu.interact("toggle", {
	text: (ctx) =>
		ctx.session.pendingDelete ? "🔄 Toggle Scraping" : "🔄 Toggle Scraping",
	do: async (ctx) => {
		const userId = ctx.match?.[1];
		if (!userId) return false;

		const user = await ctx.convex.runQuery(
			components.instarip.users.getUserById,
			{
				id: userId as never,
			},
		);

		if (!user) {
			await ctx.reply("❌ User not found");
			return false;
		}

		await ctx.convex.runMutation(components.instarip.users.toggleScraping, {
			id: userId as never,
		});

		return true; // Refresh menu
	},
});

/**
 * Edit username
 */
userDetailMenu.interact("edit", {
	text: "✏️ Edit Username",
	do: async (ctx) => {
		const userId = ctx.match?.[1];
		if (!userId) return false;

		ctx.session.awaitingInput = {
			type: "edit_username",
			userId,
		};

		await ctx.reply("Enter the new username:");
		return false;
	},
});

/**
 * Delete user (with confirmation)
 */
userDetailMenu.interact("delete", {
	text: (ctx) => (ctx.session.pendingDelete ? "⚠️ Confirm Delete?" : "🗑️ Delete"),
	do: async (ctx) => {
		const userId = ctx.match?.[1];
		if (!userId) return false;

		// If already pending, execute delete
		if (ctx.session.pendingDelete?.userId === userId) {
			await ctx.convex.runMutation(components.instarip.users.deleteUser, {
				id: userId as never,
			});
			ctx.session.pendingDelete = undefined;
			await ctx.reply("✅ User deleted");
			return "../"; // Go back to users list
		}

		// Set pending delete
		const user = await ctx.convex.runQuery(
			components.instarip.users.getUserById,
			{
				id: userId as never,
			},
		);

		if (!user) {
			await ctx.reply("❌ User not found");
			return false;
		}

		ctx.session.pendingDelete = {
			userId,
			username: user.username,
		};

		return true; // Refresh menu to show confirmation
	},
});

/**
 * Cancel delete
 */
userDetailMenu.interact("cancel", {
	text: "❌ Cancel",
	hide: (ctx) => !ctx.session.pendingDelete,
	do: async (ctx) => {
		ctx.session.pendingDelete = undefined;
		return true;
	},
});

/**
 * Back button - also clears pending delete state
 */
userDetailMenu.interact("back", {
	text: "⬅️ Back to Users",
	do: async (ctx) => {
		ctx.session.pendingDelete = undefined;
		return "../";
	},
});

/**
 * Users menu
 */
export const usersMenu = new MenuTemplate<InstaripBotContext>({
	text: "👥 <b>Users</b>\n\nManage Instagram accounts:",
	parse_mode: "HTML",
});

/**
 * Add user button
 */
usersMenu.interact("add", {
	text: "➕ Add User",
	do: async (ctx) => {
		ctx.session.awaitingInput = { type: "add_user" };
		await ctx.reply("Enter the Instagram username (with or without @):");
		return false;
	},
});

/**
 * User list with pagination
 */
usersMenu.chooseIntoSubmenu("user", userDetailMenu, {
	columns: 1,
	maxRows: 5,
	choices: async (ctx) => {
		const users = await ctx.convex.runQuery(
			components.instarip.users.getUsers,
			{},
		);
		const choices: Record<string, string> = {};
		for (const user of users) {
			const status = user.to_be_scraped ? "✅" : "❌";
			choices[user._id] = `${status} @${user.username}`;
		}
		return choices;
	},
	getCurrentPage: (ctx) => ctx.session.usersPage ?? 1,
	setPage: (ctx, page) => {
		ctx.session.usersPage = page;
	},
});

/**
 * Back to main menu
 */
usersMenu.navigate("..", { text: "⬅️ Back to Menu" });
