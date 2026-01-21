"use node";

/**
 * grammY Storage Adapter for Convex
 * Implements grammY's StorageAdapter interface using Convex database
 */

import type { GenericActionCtx } from "convex/server";
import type { StorageAdapter } from "grammy";
import { internal } from "../../_generated/api";
import type { DataModel } from "../../_generated/dataModel";

type ActionCtx = GenericActionCtx<DataModel>;

/**
 * Session data structure for the bot
 */
export interface SessionData {
	/** Input awaiting state machine */
	awaitingInput?: {
		type: "add_user" | "edit_username" | "edit_setting";
		userId?: string;
		settingPath?: string;
	};
	/** Confirmation state for delete */
	pendingDelete?: {
		userId: string;
		username: string;
	};
	/** Current page for users list pagination */
	usersPage?: number;
}

/**
 * Creates a grammY storage adapter backed by Convex database
 *
 * Note: This adapter is designed for use in Convex HTTP actions.
 * Each request gets a fresh ctx, so we create the adapter per-request.
 */
export function createStorageAdapter(
	ctx: ActionCtx,
): StorageAdapter<SessionData> {
	return {
		read: async (key: string): Promise<SessionData | undefined> => {
			const data = await ctx.runQuery(internal.sessions.getSession, { key });
			if (!data) return undefined;
			try {
				return JSON.parse(data) as SessionData;
			} catch {
				return undefined;
			}
		},

		write: async (key: string, value: SessionData): Promise<void> => {
			const data = JSON.stringify(value);
			await ctx.runMutation(internal.sessions.setSession, { key, data });
		},

		delete: async (key: string): Promise<void> => {
			await ctx.runMutation(internal.sessions.deleteSession, { key });
		},
	};
}
