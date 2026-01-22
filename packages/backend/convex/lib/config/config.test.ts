import { describe, expect, it } from "vitest";
import {
	getRandomDelayBetweenUsers,
	INSTAGRAM_DEFAULTS,
	LOCALE_DEFAULTS,
	resolveConfig,
	resolveInstagramConfig,
	resolveLocaleConfig,
	resolveTelegramConfig,
	TELEGRAM_DEFAULTS,
} from "./index";

describe("resolveTelegramConfig", () => {
	it("returns defaults when null settings provided", () => {
		const config = resolveTelegramConfig(null);
		expect(config.active).toBe(false);
		expect(config.sendLimit).toBe(TELEGRAM_DEFAULTS.SEND_LIMIT);
		expect(config.requestTimeoutMs).toBe(TELEGRAM_DEFAULTS.REQUEST_TIMEOUT_MS);
		expect(config.delayBetweenPostsMs).toBe(
			TELEGRAM_DEFAULTS.DELAY_BETWEEN_POSTS_MS,
		);
		expect(config.sendReport).toBe(false);
	});

	it("returns defaults when undefined settings provided", () => {
		const config = resolveTelegramConfig(undefined);
		expect(config.active).toBe(false);
		expect(config.sendLimit).toBe(TELEGRAM_DEFAULTS.SEND_LIMIT);
	});

	it("merges database settings with defaults", () => {
		const config = resolveTelegramConfig({
			active: true,
			send_limit: 10,
			send_report: false,
		});
		expect(config.active).toBe(true);
		expect(config.sendLimit).toBe(10);
		expect(config.sendReport).toBe(false);
		expect(config.requestTimeoutMs).toBe(TELEGRAM_DEFAULTS.REQUEST_TIMEOUT_MS);
	});

	it("handles optional fields", () => {
		const config = resolveTelegramConfig({
			active: true,
			group_chat_id: "456",
			send_report: true,
		});
		expect(config.groupChatId).toBe("456");
		expect(config.sendReport).toBe(true);
	});

	it("handles custom timeouts and delays", () => {
		const config = resolveTelegramConfig({
			active: true,
			send_report: false,
			request_timeout_ms: 60000,
			delay_between_posts_ms: 1000,
		});
		expect(config.requestTimeoutMs).toBe(60000);
		expect(config.delayBetweenPostsMs).toBe(1000);
	});
});

describe("resolveInstagramConfig", () => {
	it("returns defaults when null settings provided", () => {
		const config = resolveInstagramConfig(null);
		expect(config.active).toBe(false);
		expect(config.userLimit).toBe(INSTAGRAM_DEFAULTS.USER_LIMIT);
		expect(config.postsPerUser).toBe(INSTAGRAM_DEFAULTS.POSTS_PER_USER);
		expect(config.minScrapeIntervalMs).toBe(
			INSTAGRAM_DEFAULTS.MIN_SCRAPE_INTERVAL_MS,
		);
		expect(config.requestTimeoutMs).toBe(INSTAGRAM_DEFAULTS.REQUEST_TIMEOUT_MS);
		expect(config.delayBetweenUsersMinMs).toBe(
			INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MIN_MS,
		);
		expect(config.delayBetweenUsersMaxMs).toBe(
			INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MAX_MS,
		);
		expect(config.rateLimitMaxTokens).toBe(
			INSTAGRAM_DEFAULTS.RATE_LIMIT_MAX_TOKENS,
		);
		expect(config.rateLimitRefillRate).toBe(
			INSTAGRAM_DEFAULTS.RATE_LIMIT_REFILL_RATE,
		);
	});

	it("returns defaults when undefined settings provided", () => {
		const config = resolveInstagramConfig(undefined);
		expect(config.active).toBe(false);
		expect(config.userLimit).toBe(INSTAGRAM_DEFAULTS.USER_LIMIT);
	});

	it("merges database settings with defaults", () => {
		const config = resolveInstagramConfig({
			active: true,
			limit: 10,
			post_per_user: 50,
		});
		expect(config.active).toBe(true);
		expect(config.userLimit).toBe(10);
		expect(config.postsPerUser).toBe(50);
		expect(config.minScrapeIntervalMs).toBe(
			INSTAGRAM_DEFAULTS.MIN_SCRAPE_INTERVAL_MS,
		);
	});

	it("handles custom delay settings", () => {
		const config = resolveInstagramConfig({
			active: true,
			delay_between_users_min_ms: 5000,
			delay_between_users_max_ms: 15000,
		});
		expect(config.delayBetweenUsersMinMs).toBe(5000);
		expect(config.delayBetweenUsersMaxMs).toBe(15000);
	});

	it("handles rate limit settings", () => {
		const config = resolveInstagramConfig({
			active: true,
			rate_limit_max_tokens: 5,
			rate_limit_refill_rate: 1.0,
		});
		expect(config.rateLimitMaxTokens).toBe(5);
		expect(config.rateLimitRefillRate).toBe(1.0);
	});
});

describe("resolveLocaleConfig", () => {
	it("returns defaults when null settings provided", () => {
		const config = resolveLocaleConfig(null);
		expect(config.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
		expect(config.locale).toBe(LOCALE_DEFAULTS.LOCALE);
	});

	it("returns defaults when undefined settings provided", () => {
		const config = resolveLocaleConfig(undefined);
		expect(config.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
		expect(config.locale).toBe(LOCALE_DEFAULTS.LOCALE);
	});

	it("merges database settings with defaults", () => {
		const config = resolveLocaleConfig({
			timezone: "America/New_York",
		});
		expect(config.timezone).toBe("America/New_York");
		expect(config.locale).toBe(LOCALE_DEFAULTS.LOCALE);
	});

	it("handles custom locale", () => {
		const config = resolveLocaleConfig({
			locale: "en-US",
		});
		expect(config.locale).toBe("en-US");
		expect(config.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
	});

	it("handles both timezone and locale", () => {
		const config = resolveLocaleConfig({
			timezone: "America/New_York",
			locale: "en-US",
		});
		expect(config.timezone).toBe("America/New_York");
		expect(config.locale).toBe("en-US");
	});
});

describe("resolveConfig", () => {
	it("returns all defaults when null settings provided", () => {
		const config = resolveConfig(null);
		expect(config.telegram.active).toBe(false);
		expect(config.instagram.active).toBe(false);
		expect(config.locale.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
	});

	it("returns all defaults when undefined settings provided", () => {
		const config = resolveConfig(undefined);
		expect(config.telegram.active).toBe(false);
		expect(config.instagram.active).toBe(false);
		expect(config.locale.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
	});

	it("returns all defaults when empty object provided", () => {
		const config = resolveConfig({});
		expect(config.telegram.active).toBe(false);
		expect(config.instagram.active).toBe(false);
		expect(config.locale.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
	});

	it("merges partial settings correctly", () => {
		const config = resolveConfig({
			telegram: {
				active: true,
				send_report: true,
			},
			instagram: null,
		});
		expect(config.telegram.active).toBe(true);
		expect(config.telegram.sendReport).toBe(true);
		expect(config.instagram.active).toBe(false);
		expect(config.locale.timezone).toBe(LOCALE_DEFAULTS.TIMEZONE);
	});

	it("merges all settings correctly", () => {
		const config = resolveConfig({
			telegram: {
				active: true,
				send_limit: 5,
				send_report: false,
			},
			instagram: {
				active: true,
				limit: 3,
			},
			locale: {
				timezone: "UTC",
			},
		});
		expect(config.telegram.active).toBe(true);
		expect(config.telegram.sendLimit).toBe(5);
		expect(config.instagram.active).toBe(true);
		expect(config.instagram.userLimit).toBe(3);
		expect(config.locale.timezone).toBe("UTC");
	});
});

describe("getRandomDelayBetweenUsers", () => {
	it("returns value within configured range", () => {
		const config = resolveInstagramConfig({
			active: true,
			delay_between_users_min_ms: 1000,
			delay_between_users_max_ms: 2000,
		});

		for (let i = 0; i < 100; i++) {
			const delay = getRandomDelayBetweenUsers(config);
			expect(delay).toBeGreaterThanOrEqual(1000);
			expect(delay).toBeLessThan(2000);
		}
	});

	it("returns min value when min equals max", () => {
		const config = resolveInstagramConfig({
			active: true,
			delay_between_users_min_ms: 1000,
			delay_between_users_max_ms: 1000,
		});

		const delay = getRandomDelayBetweenUsers(config);
		expect(delay).toBe(1000);
	});

	it("returns value within default range when no custom values", () => {
		const config = resolveInstagramConfig({ active: true });

		for (let i = 0; i < 100; i++) {
			const delay = getRandomDelayBetweenUsers(config);
			expect(delay).toBeGreaterThanOrEqual(
				INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MIN_MS,
			);
			expect(delay).toBeLessThan(INSTAGRAM_DEFAULTS.DELAY_BETWEEN_USERS_MAX_MS);
		}
	});
});
