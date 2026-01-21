/**
 * Tests for bootstrap action (settings initialization)
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("bootstrap", () => {
	describe("ensureSettings", () => {
		it("creates default settings when none exist", async () => {
			const t = convexTest(schema, modules);

			// Verify no settings exist
			const before = await t.query(api.settings.getSettings, {});
			expect(before).toBeNull();

			// Run ensureSettings
			const result = await t.mutation(internal.settings.ensureSettings, {});

			expect(result).not.toBeNull();
			expect(result?._id).toBeDefined();
		});

		it("creates settings with correct defaults", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(internal.settings.ensureSettings, {});

			const settings = await t.query(api.settings.getSettings, {});

			// Telegram defaults
			expect(settings?.telegram?.active).toBe(false);
			expect(settings?.telegram?.send_report).toBe(false);

			// Instagram defaults
			expect(settings?.instagram?.active).toBe(false);

			// Locale defaults
			expect(settings?.locale?.timezone).toBe("Europe/Rome");
			expect(settings?.locale?.locale).toBe("it-IT");

			// Logging defaults
			expect(settings?.logging?.active).toBe(false);
		});

		it("is idempotent - returns existing settings", async () => {
			const t = convexTest(schema, modules);

			// First call
			const first = await t.mutation(internal.settings.ensureSettings, {});
			expect(first?._id).toBeDefined();

			// Second call - should return same settings
			const second = await t.mutation(internal.settings.ensureSettings, {});
			expect(second?._id).toBe(first?._id);
		});

		it("does not overwrite existing settings", async () => {
			const t = convexTest(schema, modules);

			// Create settings with custom values
			await t.mutation(api.settings.upsertSettings, {
				telegram: {
					active: true,
					send_report: true,
					send_limit: 10,
				},
				instagram: {
					active: true,
					limit: 20,
				},
			});

			// Run ensureSettings
			await t.mutation(internal.settings.ensureSettings, {});

			// Verify custom values preserved
			const settings = await t.query(api.settings.getSettings, {});
			expect(settings?.telegram?.active).toBe(true);
			expect(settings?.telegram?.send_report).toBe(true);
			expect(settings?.telegram?.send_limit).toBe(10);
			expect(settings?.instagram?.active).toBe(true);
			expect(settings?.instagram?.limit).toBe(20);
		});

		it("returns the existing settings object", async () => {
			const t = convexTest(schema, modules);

			// Create settings
			const settingsId = await t.mutation(api.settings.upsertSettings, {
				telegram: { active: true, send_report: false },
			});

			// Run ensureSettings
			const result = await t.mutation(internal.settings.ensureSettings, {});

			// Should return the existing settings
			expect(result?._id).toBe(settingsId);
		});
	});

	describe("bootstrap action integration", () => {
		it("initializes settings via bootstrap action pattern", async () => {
			const t = convexTest(schema, modules);

			// Simulate bootstrap action by calling ensureSettings
			const result = await t.mutation(internal.settings.ensureSettings, {});

			expect(result).not.toBeNull();

			// Settings should be queryable
			const settings = await t.query(api.settings.getSettings, {});
			expect(settings).not.toBeNull();
			expect(settings?.telegram).toBeDefined();
			expect(settings?.instagram).toBeDefined();
			expect(settings?.locale).toBeDefined();
			expect(settings?.logging).toBeDefined();
		});
	});
});
