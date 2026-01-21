/**
 * Tests for bot session storage
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("sessions", () => {
	describe("getSession", () => {
		it("returns null when session does not exist", async () => {
			const t = convexTest(schema, modules);

			const data = await t.query(internal.sessions.getSession, {
				key: "nonexistent_123",
			});

			expect(data).toBeNull();
		});

		it("returns session data when exists", async () => {
			const t = convexTest(schema, modules);

			// Create session first
			await t.mutation(internal.sessions.setSession, {
				key: "chat_123",
				data: JSON.stringify({ menu: "main", page: 1 }),
			});

			const data = await t.query(internal.sessions.getSession, {
				key: "chat_123",
			});

			expect(data).toBe(JSON.stringify({ menu: "main", page: 1 }));
		});
	});

	describe("setSession", () => {
		it("creates new session when does not exist", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(internal.sessions.setSession, {
				key: "chat_456",
				data: JSON.stringify({ state: "new" }),
			});

			const data = await t.query(internal.sessions.getSession, {
				key: "chat_456",
			});

			expect(data).toBe(JSON.stringify({ state: "new" }));
		});

		it("updates existing session", async () => {
			const t = convexTest(schema, modules);

			// Create initial session
			await t.mutation(internal.sessions.setSession, {
				key: "chat_789",
				data: JSON.stringify({ state: "initial" }),
			});

			// Update session
			await t.mutation(internal.sessions.setSession, {
				key: "chat_789",
				data: JSON.stringify({ state: "updated" }),
			});

			const data = await t.query(internal.sessions.getSession, {
				key: "chat_789",
			});

			expect(data).toBe(JSON.stringify({ state: "updated" }));
		});

		it("handles complex JSON data", async () => {
			const t = convexTest(schema, modules);

			const complexData = {
				menu: "settings",
				subMenu: "telegram",
				page: 2,
				filters: ["active", "pending"],
				user: {
					id: 123,
					name: "Test User",
				},
			};

			await t.mutation(internal.sessions.setSession, {
				key: "chat_complex",
				data: JSON.stringify(complexData),
			});

			const data = await t.query(internal.sessions.getSession, {
				key: "chat_complex",
			});

			expect(JSON.parse(data as string)).toEqual(complexData);
		});
	});

	describe("deleteSession", () => {
		it("removes existing session", async () => {
			const t = convexTest(schema, modules);

			// Create session
			await t.mutation(internal.sessions.setSession, {
				key: "chat_delete",
				data: JSON.stringify({ state: "to_delete" }),
			});

			// Verify it exists
			const beforeDelete = await t.query(internal.sessions.getSession, {
				key: "chat_delete",
			});
			expect(beforeDelete).not.toBeNull();

			// Delete session
			await t.mutation(internal.sessions.deleteSession, {
				key: "chat_delete",
			});

			// Verify it's gone
			const afterDelete = await t.query(internal.sessions.getSession, {
				key: "chat_delete",
			});
			expect(afterDelete).toBeNull();
		});

		it("does nothing when session does not exist", async () => {
			const t = convexTest(schema, modules);

			// Should not throw
			await t.mutation(internal.sessions.deleteSession, {
				key: "nonexistent_session",
			});

			const data = await t.query(internal.sessions.getSession, {
				key: "nonexistent_session",
			});
			expect(data).toBeNull();
		});
	});

	describe("session isolation", () => {
		it("maintains separate sessions for different keys", async () => {
			const t = convexTest(schema, modules);

			// Create sessions for different chats
			await t.mutation(internal.sessions.setSession, {
				key: "chat_A",
				data: JSON.stringify({ user: "Alice" }),
			});
			await t.mutation(internal.sessions.setSession, {
				key: "chat_B",
				data: JSON.stringify({ user: "Bob" }),
			});

			// Verify isolation
			const dataA = await t.query(internal.sessions.getSession, {
				key: "chat_A",
			});
			const dataB = await t.query(internal.sessions.getSession, {
				key: "chat_B",
			});

			expect(JSON.parse(dataA as string).user).toBe("Alice");
			expect(JSON.parse(dataB as string).user).toBe("Bob");
		});

		it("delete only affects target session", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(internal.sessions.setSession, {
				key: "chat_X",
				data: JSON.stringify({ keep: true }),
			});
			await t.mutation(internal.sessions.setSession, {
				key: "chat_Y",
				data: JSON.stringify({ delete: true }),
			});

			// Delete only Y
			await t.mutation(internal.sessions.deleteSession, {
				key: "chat_Y",
			});

			// X should still exist
			const dataX = await t.query(internal.sessions.getSession, {
				key: "chat_X",
			});
			expect(dataX).not.toBeNull();

			// Y should be gone
			const dataY = await t.query(internal.sessions.getSession, {
				key: "chat_Y",
			});
			expect(dataY).toBeNull();
		});
	});
});
