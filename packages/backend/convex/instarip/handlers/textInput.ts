"use node";

/**
 * Instarip Text Input Handler
 * State machine for handling user text input (add user, edit username, edit setting)
 */

import { components } from "../../_generated/api";
import type { Id } from "../../components/instarip/_generated/dataModel";
import type { InstaripBotContext } from "../bot";

/**
 * Validate Instagram username format
 * Rules:
 * - Only letters (a-z), numbers (0-9), periods (.), and underscores (_)
 * - Cannot start or end with a period
 * - Cannot have consecutive periods
 * - Length: 1-30 characters
 */
function isValidInstagramUsername(username: string): {
	valid: boolean;
	error?: string;
} {
	if (username.length < 1 || username.length > 30) {
		return {
			valid: false,
			error: "Username must be between 1 and 30 characters",
		};
	}

	if (!/^[a-zA-Z0-9._]+$/.test(username)) {
		return {
			valid: false,
			error: "Only letters, numbers, dots and underscores allowed",
		};
	}

	if (username.startsWith(".") || username.endsWith(".")) {
		return {
			valid: false,
			error: "Username cannot start or end with a period",
		};
	}

	if (username.includes("..")) {
		return { valid: false, error: "Username cannot have consecutive periods" };
	}

	return { valid: true };
}

/**
 * Handle text messages based on awaiting input state
 */
export async function handleTextInput(ctx: InstaripBotContext): Promise<void> {
	const awaiting = ctx.session.awaitingInput;
	if (!awaiting) return; // No input expected, ignore

	const text = ctx.message?.text?.trim();
	if (!text) return;

	try {
		switch (awaiting.type) {
			case "add_user":
				await handleAddUser(ctx, text);
				break;
			case "edit_username":
				if (!awaiting.userId) {
					await ctx.reply("❌ Missing user ID. Use /start to try again.");
					return;
				}
				await handleEditUsername(ctx, text, awaiting.userId);
				break;
			case "edit_setting":
				if (!awaiting.settingPath) {
					await ctx.reply("❌ Missing setting path. Use /start to try again.");
					return;
				}
				await handleEditSetting(ctx, text, awaiting.settingPath);
				break;
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await ctx.reply(`❌ Error: ${msg}`);
	}

	// Clear awaiting state
	ctx.session.awaitingInput = undefined;
}

/**
 * Handle adding a new user
 */
async function handleAddUser(
	ctx: InstaripBotContext,
	username: string,
): Promise<void> {
	const cleanUsername = username.replace(/^@/, "");

	const validation = isValidInstagramUsername(cleanUsername);
	if (!validation.valid) {
		await ctx.reply(`❌ ${validation.error}\n\nUse /start to try again.`);
		return;
	}

	try {
		await ctx.convex.runMutation(components.instarip.users.createUser, {
			username: cleanUsername,
		});
		await ctx.reply(`✅ User @${cleanUsername} added successfully!`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		if (msg.includes("already exists")) {
			await ctx.reply(`❌ User @${cleanUsername} already exists.`);
		} else {
			await ctx.reply(`❌ Failed to add user: ${msg}`);
		}
	}
}

/**
 * Handle editing a username
 */
async function handleEditUsername(
	ctx: InstaripBotContext,
	username: string,
	userId: string,
): Promise<void> {
	const cleanUsername = username.replace(/^@/, "");

	const validation = isValidInstagramUsername(cleanUsername);
	if (!validation.valid) {
		await ctx.reply(`❌ ${validation.error}\n\nUse /start to try again.`);
		return;
	}

	try {
		await ctx.convex.runMutation(components.instarip.users.updateUsername, {
			id: userId as Id<"users">,
			username: cleanUsername,
		});
		await ctx.reply(`✅ Username updated to @${cleanUsername}!`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		if (msg.includes("already exists")) {
			await ctx.reply(`❌ User @${cleanUsername} already exists.`);
		} else {
			await ctx.reply(`❌ Failed to update username: ${msg}`);
		}
	}
}

/**
 * Handle editing a setting
 */
async function handleEditSetting(
	ctx: InstaripBotContext,
	value: string,
	settingPath: string,
): Promise<void> {
	try {
		await ctx.convex.runMutation(components.instarip.settings.updateSetting, {
			path: settingPath,
			value,
		});
		await ctx.reply(`✅ Setting updated!`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown error";
		await ctx.reply(`❌ Failed to update setting: ${msg}`);
	}
}
