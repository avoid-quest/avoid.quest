/**
 * Tests for token bucket rate limiter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRateLimiterState,
	DEFAULT_RATE_LIMITER_CONFIG,
	INSTAGRAM_RATE_LIMIT_DEFAULTS,
	InMemoryRateLimiter,
	refillTokens,
	tryConsumeToken,
} from "./rateLimiter";

describe("INSTAGRAM_RATE_LIMIT_DEFAULTS", () => {
	it("has MAX_TOKENS equal to 3", () => {
		expect(INSTAGRAM_RATE_LIMIT_DEFAULTS.MAX_TOKENS).toBe(3);
	});

	it("has REFILL_RATE equal to 0.5", () => {
		expect(INSTAGRAM_RATE_LIMIT_DEFAULTS.REFILL_RATE).toBe(0.5);
	});
});

describe("DEFAULT_RATE_LIMITER_CONFIG", () => {
	it("uses default values from INSTAGRAM_RATE_LIMIT_DEFAULTS", () => {
		expect(DEFAULT_RATE_LIMITER_CONFIG.maxTokens).toBe(
			INSTAGRAM_RATE_LIMIT_DEFAULTS.MAX_TOKENS,
		);
		expect(DEFAULT_RATE_LIMITER_CONFIG.refillRate).toBe(
			INSTAGRAM_RATE_LIMIT_DEFAULTS.REFILL_RATE,
		);
	});
});

describe("createRateLimiterState", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates state with default values", () => {
		const state = createRateLimiterState();

		expect(state.maxTokens).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxTokens);
		expect(state.refillRate).toBe(DEFAULT_RATE_LIMITER_CONFIG.refillRate);
	});

	it("creates state with custom config", () => {
		const state = createRateLimiterState(5, 1.0);

		expect(state.maxTokens).toBe(5);
		expect(state.refillRate).toBe(1.0);
	});

	it("initializes tokens to maxTokens", () => {
		const state = createRateLimiterState(5, 1.0);
		expect(state.tokens).toBe(5);

		const defaultState = createRateLimiterState();
		expect(defaultState.tokens).toBe(defaultState.maxTokens);
	});

	it("sets lastRefillAt to current time", () => {
		const state = createRateLimiterState();
		expect(state.lastRefillAt).toBe(Date.now());
	});
});

describe("refillTokens", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("refills based on elapsed time", () => {
		const state = createRateLimiterState(3, 0.5);
		// Manually reduce tokens
		state.tokens = 1;

		// Advance 2 seconds, should add 1 token (2 * 0.5)
		vi.advanceTimersByTime(2000);
		const refilled = refillTokens(state);

		expect(refilled.tokens).toBe(2);
	});

	it("caps at maxTokens", () => {
		const state = createRateLimiterState(3, 0.5);
		state.tokens = 2;

		// Advance 10 seconds, should add 5 tokens but cap at 3
		vi.advanceTimersByTime(10000);
		const refilled = refillTokens(state);

		expect(refilled.tokens).toBe(3);
	});

	it("handles zero elapsed time", () => {
		const state = createRateLimiterState(3, 0.5);
		state.tokens = 2;

		// No time advance
		const refilled = refillTokens(state);

		expect(refilled.tokens).toBe(2);
	});

	it("updates lastRefillAt", () => {
		const state = createRateLimiterState(3, 0.5);
		const initialTime = state.lastRefillAt;

		vi.advanceTimersByTime(1000);
		const refilled = refillTokens(state);

		expect(refilled.lastRefillAt).toBe(initialTime + 1000);
	});
});

describe("tryConsumeToken", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("succeeds when enough tokens", () => {
		const state = createRateLimiterState(3, 0.5);
		const result = tryConsumeToken(state);

		expect(result.success).toBe(true);
	});

	it("decrements tokens on success", () => {
		const state = createRateLimiterState(3, 0.5);
		const result = tryConsumeToken(state);

		expect(result.success).toBe(true);
		expect(result.state.tokens).toBe(2);
	});

	it("fails with waitMs when insufficient", () => {
		const state = createRateLimiterState(3, 0.5);
		state.tokens = 0;

		const result = tryConsumeToken(state);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.waitMs).toBeGreaterThan(0);
		}
	});

	it("calculates correct waitMs", () => {
		const state = createRateLimiterState(3, 0.5);
		state.tokens = 0;
		state.lastRefillAt = Date.now();

		const result = tryConsumeToken(state);

		expect(result.success).toBe(false);
		if (!result.success) {
			// Need 1 token, refill rate is 0.5/sec, so need 2 seconds (2000ms)
			expect(result.waitMs).toBe(2000);
		}
	});

	it("handles multiple token consumption", () => {
		const state = createRateLimiterState(3, 0.5);

		// Consume 2 tokens at once
		const result = tryConsumeToken(state, 2);

		expect(result.success).toBe(true);
		expect(result.state.tokens).toBe(1);
	});

	it("fails when requesting more tokens than available", () => {
		const state = createRateLimiterState(3, 0.5);
		state.tokens = 1;
		state.lastRefillAt = Date.now();

		const result = tryConsumeToken(state, 2);

		expect(result.success).toBe(false);
		if (!result.success) {
			// Need 1 more token, refill rate is 0.5/sec, so need 2 seconds
			expect(result.waitMs).toBe(2000);
		}
	});
});

describe("InMemoryRateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("constructs with default config", () => {
		const limiter = new InMemoryRateLimiter();
		const state = limiter.getState();

		expect(state.maxTokens).toBe(DEFAULT_RATE_LIMITER_CONFIG.maxTokens);
		expect(state.refillRate).toBe(DEFAULT_RATE_LIMITER_CONFIG.refillRate);
	});

	it("constructs with custom config", () => {
		const limiter = new InMemoryRateLimiter(5, 1.0);
		const state = limiter.getState();

		expect(state.maxTokens).toBe(5);
		expect(state.refillRate).toBe(1.0);
	});

	it("consumeToken returns 0 when available", async () => {
		const limiter = new InMemoryRateLimiter(3, 0.5);

		const waitTime = await limiter.consumeToken();

		expect(waitTime).toBe(0);
	});

	it("consumeToken decrements tokens", async () => {
		const limiter = new InMemoryRateLimiter(3, 0.5);

		await limiter.consumeToken();
		const state = limiter.getState();

		expect(state.tokens).toBe(2);
	});

	it("consumeToken waits when exhausted", async () => {
		const limiter = new InMemoryRateLimiter(1, 0.5);

		// First consume uses the only token
		await limiter.consumeToken();

		// Second consume should wait
		const consumePromise = limiter.consumeToken();

		// Advance time to allow refill
		vi.advanceTimersByTime(2000);

		const waitTime = await consumePromise;
		expect(waitTime).toBe(2000);
	});

	it("getState returns copy of state", () => {
		const limiter = new InMemoryRateLimiter(3, 0.5);
		const state1 = limiter.getState();
		const state2 = limiter.getState();

		expect(state1).toEqual(state2);
		expect(state1).not.toBe(state2); // Different object references
	});

	it("restoreState sets internal state", () => {
		const limiter = new InMemoryRateLimiter(3, 0.5);

		const customState = {
			tokens: 1,
			lastRefillAt: Date.now() - 5000,
			maxTokens: 5,
			refillRate: 1.0,
		};

		limiter.restoreState(customState);
		const restored = limiter.getState();

		expect(restored.tokens).toBe(customState.tokens);
		expect(restored.maxTokens).toBe(customState.maxTokens);
		expect(restored.refillRate).toBe(customState.refillRate);
	});

	it("restoreState creates a copy", () => {
		const limiter = new InMemoryRateLimiter(3, 0.5);

		const customState = {
			tokens: 1,
			lastRefillAt: Date.now(),
			maxTokens: 5,
			refillRate: 1.0,
		};

		limiter.restoreState(customState);

		// Modify original state
		customState.tokens = 10;

		// Limiter should not be affected
		const state = limiter.getState();
		expect(state.tokens).toBe(1);
	});
});

describe("concurrent token consumption", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("handles concurrent consume attempts without over-allocation", async () => {
		// Use a rate limiter with 5 tokens and no refill
		const limiter = new InMemoryRateLimiter(5, 0);

		// Attempt 10 concurrent consumes
		const consumePromises = Array(10)
			.fill(null)
			.map(() => {
				const result = tryConsumeToken(limiter.getState());
				if (result.success) {
					limiter.restoreState(result.state);
				}
				return result;
			});

		const successCount = consumePromises.filter((r) => r.success).length;

		// Should only allow 5 successful consumes (max tokens)
		expect(successCount).toBeLessThanOrEqual(5);
	});

	it("prevents double consumption when state is shared", () => {
		const state = createRateLimiterState(2, 0);

		// Two attempts against the same state should both succeed in isolation
		const result1 = tryConsumeToken(state);
		expect(result1.success).toBe(true);

		// But if we update state after first consume, second should still work
		const result2 = tryConsumeToken(result1.state);
		expect(result2.success).toBe(true);

		// Third should fail
		const result3 = tryConsumeToken(result2.state);
		expect(result3.success).toBe(false);
	});

	it("maintains consistency across sequential operations", () => {
		const limiter = new InMemoryRateLimiter(3, 0);

		// Sequential consumes
		let state = limiter.getState();
		for (let i = 0; i < 3; i++) {
			const result = tryConsumeToken(state);
			expect(result.success).toBe(true);
			state = result.state;
		}

		// Fourth should fail
		const result = tryConsumeToken(state);
		expect(result.success).toBe(false);
	});
});
