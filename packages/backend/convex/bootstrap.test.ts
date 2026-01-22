/**
 * Tests for bootstrap action
 *
 * Bootstrap initializes default settings via the instarip component's
 * ensureSettings mutation. The core functionality is tested in:
 * - components/instarip/settings.test.ts (ensureSettings tests)
 *
 * These tests verify the bootstrap module structure and export.
 */

import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";

describe("bootstrap", () => {
	describe("module structure", () => {
		it("exports bootstrap action", () => {
			expect(api.bootstrap).toBeDefined();
			expect(api.bootstrap.bootstrap).toBeDefined();
		});

		it("bootstrap action has correct function reference", () => {
			// Verify the action is properly exported and accessible
			const bootstrapFn = api.bootstrap.bootstrap;
			expect(bootstrapFn).toBeDefined();
			expect(typeof bootstrapFn).toBe("object"); // Convex function references are objects
		});
	});

	/**
	 * Integration tests for bootstrap require a full Convex environment with
	 * registered components. The underlying ensureSettings mutation is
	 * thoroughly tested in components/instarip/settings.test.ts:
	 *
	 * - ensureSettings creates default settings when none exist
	 * - ensureSettings creates settings with correct defaults
	 * - ensureSettings is idempotent
	 * - ensureSettings does not overwrite existing settings
	 */
});
