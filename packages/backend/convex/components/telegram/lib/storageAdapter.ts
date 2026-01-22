/**
 * grammY Storage Adapter for Convex
 * Implements grammY's StorageAdapter interface using Convex database
 *
 * This is a generic storage adapter that can be used by any app.
 * Apps define their own SessionData type that must extend BaseSessionData.
 */

import type { GenericActionCtx } from "convex/server";
import type { StorageAdapter } from "grammy";
import { internal } from "../../../_generated/api";
import type { DataModel } from "../../../_generated/dataModel";

type ActionCtx = GenericActionCtx<DataModel>;

/**
 * Base session data that all apps must include
 * Apps can extend this with additional fields
 */
export interface BaseSessionData {
	/** Input awaiting state machine */
	awaitingInput?: {
		type: string;
		[key: string]: unknown;
	};
}

/**
 * Session data structure for Instarip bot
 * Extends BaseSessionData with Instarip-specific fields
 */
export interface SessionData extends BaseSessionData {
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
 *
 * @template TSessionData - The session data type (must extend BaseSessionData)
 * @param ctx - Convex action context
 * @returns A grammY-compatible storage adapter
 */
export function createStorageAdapter<
	TSessionData extends BaseSessionData = SessionData,
>(ctx: ActionCtx): StorageAdapter<TSessionData> {
	return {
		read: async (key: string): Promise<TSessionData | undefined> => {
			const data = await ctx.runQuery(internal.sessions.getSession, { key });
			if (!data) return undefined;
			try {
				return JSON.parse(data) as TSessionData;
			} catch {
				return undefined;
			}
		},

		write: async (key: string, value: TSessionData): Promise<void> => {
			const data = JSON.stringify(value);
			await ctx.runMutation(internal.sessions.setSession, { key, data });
		},

		delete: async (key: string): Promise<void> => {
			await ctx.runMutation(internal.sessions.deleteSession, { key });
		},
	};
}
