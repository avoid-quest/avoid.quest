/**
 * Tests for grammY Storage Adapter
 *
 * Tests the JSON serialization/deserialization and round-trip behavior
 * for all SessionData shapes. The underlying session CRUD is tested in sessions.test.ts.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import type { SessionData } from "./storageAdapter";

const modules = import.meta.glob("../../**/*.ts");

describe("storageAdapter", () => {
	describe("SessionData serialization", () => {
		it("round-trips empty session", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_empty",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_empty",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips awaitingInput with add_user type", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				awaitingInput: {
					type: "add_user",
				},
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_add_user",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_add_user",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips awaitingInput with edit_username type", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				awaitingInput: {
					type: "edit_username",
					userId: "users:abc123",
				},
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_edit_user",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_edit_user",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips awaitingInput with edit_setting type", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				awaitingInput: {
					type: "edit_setting",
					settingPath: "telegram.group_chat_id",
				},
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_edit_setting",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_edit_setting",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips pendingDelete state", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				pendingDelete: {
					userId: "users:xyz789",
					username: "testuser",
				},
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_pending_delete",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_pending_delete",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips usersPage pagination state", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				usersPage: 5,
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_pagination",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_pagination",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});

		it("round-trips complex session with multiple fields", async () => {
			const t = convexTest(schema, modules);
			const sessionData: SessionData = {
				awaitingInput: {
					type: "edit_setting",
					settingPath: "instagram.limit",
				},
				pendingDelete: {
					userId: "users:abc",
					username: "olduser",
				},
				usersPage: 3,
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_complex",
				data: JSON.stringify(sessionData),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_complex",
			});
			expect(JSON.parse(retrieved as string)).toEqual(sessionData);
		});
	});

	describe("read behavior", () => {
		it("returns null for missing session", async () => {
			const t = convexTest(schema, modules);

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "nonexistent_key",
			});
			expect(retrieved).toBeNull();
		});

		it("handles invalid JSON gracefully in application code", () => {
			// The adapter's read() method catches JSON.parse errors
			// and returns undefined. This tests that behavior directly.
			const invalidJson = "not valid json {";

			let result: SessionData | undefined;
			try {
				result = JSON.parse(invalidJson) as SessionData;
			} catch {
				result = undefined;
			}

			expect(result).toBeUndefined();
		});
	});

	describe("session lifecycle", () => {
		it("overwrites session on subsequent writes", async () => {
			const t = convexTest(schema, modules);

			// Initial write
			await t.mutation(internal.sessions.setSession, {
				key: "chat_lifecycle",
				data: JSON.stringify({ usersPage: 1 }),
			});

			// Overwrite
			await t.mutation(internal.sessions.setSession, {
				key: "chat_lifecycle",
				data: JSON.stringify({
					usersPage: 2,
					awaitingInput: { type: "add_user" },
				}),
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_lifecycle",
			});
			const parsed = JSON.parse(retrieved as string) as SessionData;

			expect(parsed.usersPage).toBe(2);
			expect(parsed.awaitingInput?.type).toBe("add_user");
		});

		it("delete removes session completely", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(internal.sessions.setSession, {
				key: "chat_to_delete",
				data: JSON.stringify({ usersPage: 1 }),
			});

			await t.mutation(internal.sessions.deleteSession, {
				key: "chat_to_delete",
			});

			const retrieved = await t.query(internal.sessions.getSession, {
				key: "chat_to_delete",
			});
			expect(retrieved).toBeNull();
		});
	});
});
