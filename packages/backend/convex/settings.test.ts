import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("settings", () => {
	describe("getSettingsInternal", () => {
		it("returns null when no settings exist", async () => {
			const t = convexTest(schema, modules);
			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings).toBeNull();
		});
	});

	describe("upsertSettings", () => {
		it("creates settings with telegram config", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				telegram: {
					active: true,
					send_report: false,
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.telegram?.active).toBe(true);
			expect(settings?.telegram?.send_report).toBe(false);
		});

		it("creates settings with instagram config", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				instagram: {
					active: true,
					limit: 10,
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.instagram?.active).toBe(true);
			expect(settings?.instagram?.limit).toBe(10);
		});

		it("creates settings with locale config", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				locale: {
					timezone: "America/New_York",
					locale: "en-US",
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.locale?.timezone).toBe("America/New_York");
			expect(settings?.locale?.locale).toBe("en-US");
		});

		it("creates settings with all configs", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				telegram: {
					active: true,
					send_report: true,
					send_limit: 5,
				},
				instagram: {
					active: true,
					limit: 3,
					post_per_user: 50,
				},
				locale: {
					timezone: "Europe/Rome",
				},
				logging: {
					active: false,
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.telegram?.active).toBe(true);
			expect(settings?.telegram?.send_limit).toBe(5);
			expect(settings?.instagram?.active).toBe(true);
			expect(settings?.instagram?.limit).toBe(3);
			expect(settings?.locale?.timezone).toBe("Europe/Rome");
			expect(settings?.logging?.active).toBe(false);
		});

		it("updates existing settings", async () => {
			const t = convexTest(schema, modules);

			const id = await t.mutation(api.settings.upsertSettings, {
				telegram: { active: false, send_report: false },
			});

			await t.mutation(api.settings.upsertSettings, {
				id,
				telegram: { active: true, send_report: true },
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.telegram?.active).toBe(true);
			expect(settings?.telegram?.send_report).toBe(true);
		});

		it("can update only specific sections", async () => {
			const t = convexTest(schema, modules);

			const id = await t.mutation(api.settings.upsertSettings, {
				telegram: { active: true, send_report: false },
				instagram: { active: false },
			});

			// Update only instagram
			await t.mutation(api.settings.upsertSettings, {
				id,
				instagram: { active: true, limit: 10 },
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			// Instagram should be updated
			expect(settings?.instagram?.active).toBe(true);
			expect(settings?.instagram?.limit).toBe(10);
		});

		it("handles optional fields in telegram settings", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				telegram: {
					active: true,
					send_report: false,
					admin_chat_id: "123456",
					group_chat_id: "789012",
					request_timeout_ms: 60000,
					delay_between_posts_ms: 1000,
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.telegram?.admin_chat_id).toBe("123456");
			expect(settings?.telegram?.group_chat_id).toBe("789012");
			expect(settings?.telegram?.request_timeout_ms).toBe(60000);
			expect(settings?.telegram?.delay_between_posts_ms).toBe(1000);
		});

		it("handles optional fields in instagram settings", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				instagram: {
					active: true,
					post_per_user: 30,
					request_timeout_ms: 15000,
					min_scrape_interval_ms: 1800000,
					delay_between_users_min_ms: 5000,
					delay_between_users_max_ms: 15000,
					rate_limit_max_tokens: 5,
					rate_limit_refill_rate: 1.0,
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.instagram?.post_per_user).toBe(30);
			expect(settings?.instagram?.request_timeout_ms).toBe(15000);
			expect(settings?.instagram?.min_scrape_interval_ms).toBe(1800000);
			expect(settings?.instagram?.delay_between_users_min_ms).toBe(5000);
			expect(settings?.instagram?.delay_between_users_max_ms).toBe(15000);
			expect(settings?.instagram?.rate_limit_max_tokens).toBe(5);
			expect(settings?.instagram?.rate_limit_refill_rate).toBe(1.0);
		});

		it("handles logging settings", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				logging: {
					active: true,
					max_retention_days: 30,
					log_level: "debug",
				},
			});

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings?.logging?.active).toBe(true);
			expect(settings?.logging?.max_retention_days).toBe(30);
			expect(settings?.logging?.log_level).toBe("debug");
		});
	});

	describe("getSettings (public query)", () => {
		it("returns null when no settings exist", async () => {
			const t = convexTest(schema, modules);
			const settings = await t.query(api.settings.getSettings, {});
			expect(settings).toBeNull();
		});

		it("returns settings when they exist", async () => {
			const t = convexTest(schema, modules);

			await t.mutation(api.settings.upsertSettings, {
				telegram: { active: true, send_report: false },
			});

			const settings = await t.query(api.settings.getSettings, {});
			expect(settings?.telegram?.active).toBe(true);
		});
	});

	describe("deleteSettings", () => {
		it("deletes existing settings", async () => {
			const t = convexTest(schema, modules);

			const id = await t.mutation(api.settings.upsertSettings, {
				telegram: { active: true, send_report: false },
			});

			await t.mutation(api.settings.deleteSettings, { id });

			const settings = await t.query(internal.settings.getSettingsInternal);
			expect(settings).toBeNull();
		});
	});
});
