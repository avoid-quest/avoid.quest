/**
 * Tests for token bucket rate limiter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRateLimiterState,
	DEFAULT_RATE_LIMITER_CONFIG,
	InMemoryRateLimiter,
	refillTokens,
	tryConsumeToken,
} from "./rateLimiter";

describe("createRateLimiterState", () => {
	it("creates state with default config", () => {
		const state = createRateLimiterState();

		expect(state.tokens).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxTokens);
		expect(state.maxTokens).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxTokens);
		expect(state.refillRate).toBe(DEFAULT_RATE_LIMITER_CONFIG.refillRate);
		expect(state.lastRefillAt).toBeGreaterThan(0);
	});

	it("creates state with custom config", () => {
		const state = createRateLimiterState(10, 2.0);

		expect(state.tokens).toBe(10);
		expect(state.maxTokens).toBe(10);
		expect(state.refillRate).toBe(2.0);
	});

	it("starts with full token bucket", () => {
		const state = createRateLimiterState(5, 1.0);
		expect(state.tokens).toBe(state.maxTokens);
	});
});

describe("refillTokens", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("adds tokens based on elapsed time", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);

		// Consume some tokens
		const depleted = { ...state, tokens: 1 };

		// Advance 2 seconds
		vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
		const refilled = refillTokens(depleted);

		// Should have added 2 tokens (1 per second * 2 seconds)
		expect(refilled.tokens).toBe(3);
	});

	it("caps tokens at maxTokens", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 10.0);

		// Start at 4 tokens
		const partial = { ...state, tokens: 4 };

		// Advance 10 seconds (would add 100 tokens at rate 10)
		vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));
		const refilled = refillTokens(partial);

		expect(refilled.tokens).toBe(5); // Capped at maxTokens
	});

	it("updates lastRefillAt timestamp", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);

		vi.setSystemTime(new Date("2024-01-01T00:00:05Z"));
		const refilled = refillTokens(state);

		expect(refilled.lastRefillAt).toBe(
			new Date("2024-01-01T00:00:05Z").getTime(),
		);
	});

	it("handles fractional token refill", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 0.5); // 0.5 tokens per second

		// Start at 0 tokens
		const depleted = { ...state, tokens: 0 };

		// Advance 3 seconds
		vi.setSystemTime(new Date("2024-01-01T00:00:03Z"));
		const refilled = refillTokens(depleted);

		// Should have 1.5 tokens
		expect(refilled.tokens).toBe(1.5);
	});
});

describe("tryConsumeToken", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("succeeds when tokens available", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);

		const result = tryConsumeToken(state);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.state.tokens).toBe(4);
		}
	});

	it("fails when insufficient tokens", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);
		const depleted = { ...state, tokens: 0 };

		const result = tryConsumeToken(depleted);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.waitMs).toBeGreaterThan(0);
		}
	});

	it("calculates correct wait time", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 0.5); // 0.5 tokens per second
		const depleted = { ...state, tokens: 0 };

		const result = tryConsumeToken(depleted);

		expect(result.success).toBe(false);
		if (!result.success) {
			// Need 1 token, refill rate 0.5/sec = 2 seconds = 2000ms
			expect(result.waitMs).toBe(2000);
		}
	});

	it("consumes multiple tokens", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);

		const result = tryConsumeToken(state, 3);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.state.tokens).toBe(2);
		}
	});

	it("fails when requesting more tokens than available", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);
		const partial = { ...state, tokens: 2 };

		const result = tryConsumeToken(partial, 3);

		expect(result.success).toBe(false);
		if (!result.success) {
			// Need 1 more token at rate 1/sec = 1000ms
			expect(result.waitMs).toBe(1000);
		}
	});

	it("refills before checking", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const state = createRateLimiterState(5, 1.0);
		const depleted = { ...state, tokens: 0 };

		// Advance 2 seconds
		vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
		const result = tryConsumeToken(depleted);

		// Should have refilled 2 tokens and consumed 1
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.state.tokens).toBe(1);
		}
	});
});

describe("InMemoryRateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates limiter with default config", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const limiter = new InMemoryRateLimiter();
		const state = limiter.getState();

		expect(state.maxTokens).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxTokens);
		expect(state.refillRate).toBe(DEFAULT_RATE_LIMITER_CONFIG.refillRate);
	});

	it("creates limiter with custom config", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const limiter = new InMemoryRateLimiter(10, 2.0);
		const state = limiter.getState();

		expect(state.maxTokens).toBe(10);
		expect(state.refillRate).toBe(2.0);
	});

	it("consumeToken returns 0 when tokens available", async () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const limiter = new InMemoryRateLimiter(5, 1.0);

		const waitTime = await limiter.consumeToken();

		expect(waitTime).toBe(0);
		expect(limiter.getState().tokens).toBe(4);
	});

	it("getState returns copy of internal state", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const limiter = new InMemoryRateLimiter(5, 1.0);
		const state1 = limiter.getState();
		const state2 = limiter.getState();

		expect(state1).not.toBe(state2); // Different objects
		expect(state1).toEqual(state2); // Same values
	});

	it("restoreState updates internal state", () => {
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const limiter = new InMemoryRateLimiter(5, 1.0);
		const savedState = {
			tokens: 2,
			lastRefillAt: Date.now() - 1000,
			maxTokens: 5,
			refillRate: 1.0,
		};

		limiter.restoreState(savedState);
		const restored = limiter.getState();

		expect(restored.tokens).toBe(2);
	});
});
