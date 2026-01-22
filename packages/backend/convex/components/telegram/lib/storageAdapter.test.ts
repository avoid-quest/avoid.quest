/**
 * Tests for grammY storage adapter
 */

import type { GenericActionCtx } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataModel } from "../../../_generated/dataModel";
import type { BaseSessionData } from "./storageAdapter";
import { createStorageAdapter } from "./storageAdapter";

// Mock the internal API reference
vi.mock("../../../_generated/api", () => ({
	internal: {
		sessions: {
			getSession: "internal.sessions.getSession",
			setSession: "internal.sessions.setSession",
			deleteSession: "internal.sessions.deleteSession",
		},
	},
}));

// Helper to create mock ActionCtx
function createMockCtx() {
	return {
		runQuery: vi.fn(),
		runMutation: vi.fn(),
		// Add other required ActionCtx properties as stubs
		auth: {},
		storage: {},
		scheduler: {},
		vectorSearch: vi.fn(),
	};
}

// Test session data type
interface TestSessionData extends BaseSessionData {
	testField?: string;
	counter?: number;
}

describe("createStorageAdapter", () => {
	let mockCtx: ReturnType<typeof createMockCtx>;
	let adapter: ReturnType<typeof createStorageAdapter<TestSessionData>>;

	beforeEach(() => {
		mockCtx = createMockCtx();
		adapter = createStorageAdapter<TestSessionData>(
			mockCtx as unknown as GenericActionCtx<DataModel>,
		);
	});

	describe("read", () => {
		it("returns undefined when no session exists", async () => {
			mockCtx.runQuery.mockResolvedValueOnce(null);

			const result = await adapter.read("session_123");

			expect(result).toBeUndefined();
			expect(mockCtx.runQuery).toHaveBeenCalledWith(
				"internal.sessions.getSession",
				{ key: "session_123" },
			);
		});

		it("returns parsed data when session exists", async () => {
			const sessionData: TestSessionData = {
				testField: "value",
				counter: 42,
			};
			mockCtx.runQuery.mockResolvedValueOnce(JSON.stringify(sessionData));

			const result = await adapter.read("session_456");

			expect(result).toEqual(sessionData);
			expect(mockCtx.runQuery).toHaveBeenCalledWith(
				"internal.sessions.getSession",
				{ key: "session_456" },
			);
		});

		it("returns undefined for invalid JSON", async () => {
			mockCtx.runQuery.mockResolvedValueOnce("invalid json {{{");

			const result = await adapter.read("session_invalid");

			expect(result).toBeUndefined();
		});

		it("returns session with awaitingInput field", async () => {
			const sessionData: TestSessionData = {
				awaitingInput: {
					type: "add_user",
				},
			};
			mockCtx.runQuery.mockResolvedValueOnce(JSON.stringify(sessionData));

			const result = await adapter.read("session_awaiting");

			expect(result).toEqual(sessionData);
			expect(result?.awaitingInput?.type).toBe("add_user");
		});
	});

	describe("write", () => {
		it("calls mutation with serialized data", async () => {
			mockCtx.runMutation.mockResolvedValueOnce(undefined);

			const sessionData: TestSessionData = {
				testField: "test",
				counter: 1,
			};

			await adapter.write("session_write", sessionData);

			expect(mockCtx.runMutation).toHaveBeenCalledWith(
				"internal.sessions.setSession",
				{
					key: "session_write",
					data: JSON.stringify(sessionData),
				},
			);
		});

		it("handles complex session data", async () => {
			mockCtx.runMutation.mockResolvedValueOnce(undefined);

			const complexSession: TestSessionData = {
				awaitingInput: {
					type: "edit_setting",
					settingPath: "notifications.enabled",
				},
				testField: "complex",
				counter: 100,
			};

			await adapter.write("session_complex", complexSession);

			expect(mockCtx.runMutation).toHaveBeenCalledWith(
				"internal.sessions.setSession",
				{
					key: "session_complex",
					data: JSON.stringify(complexSession),
				},
			);

			// Verify the JSON can be parsed back correctly
			const [, args] = mockCtx.runMutation.mock.calls[0] as [
				string,
				{ data: string },
			];
			expect(JSON.parse(args.data)).toEqual(complexSession);
		});

		it("handles empty session data", async () => {
			mockCtx.runMutation.mockResolvedValueOnce(undefined);

			await adapter.write("session_empty", {});

			expect(mockCtx.runMutation).toHaveBeenCalledWith(
				"internal.sessions.setSession",
				{
					key: "session_empty",
					data: "{}",
				},
			);
		});
	});

	describe("delete", () => {
		it("calls mutation to delete session", async () => {
			mockCtx.runMutation.mockResolvedValueOnce(undefined);

			await adapter.delete("session_delete");

			expect(mockCtx.runMutation).toHaveBeenCalledWith(
				"internal.sessions.deleteSession",
				{ key: "session_delete" },
			);
		});

		it("completes without error even if session does not exist", async () => {
			mockCtx.runMutation.mockResolvedValueOnce(undefined);

			await expect(
				adapter.delete("nonexistent_session"),
			).resolves.toBeUndefined();
		});
	});

	describe("adapter interface", () => {
		it("implements read, write, delete methods", () => {
			expect(adapter.read).toBeDefined();
			expect(adapter.write).toBeDefined();
			expect(adapter.delete).toBeDefined();
			expect(typeof adapter.read).toBe("function");
			expect(typeof adapter.write).toBe("function");
			expect(typeof adapter.delete).toBe("function");
		});
	});
});
