/**
 * Token bucket rate limiter for Instagram API requests
 * Prevents hitting Instagram's rate limits
 */

import { INSTAGRAM_DEFAULTS } from "../../../lib/config";

export type RateLimiterState = {
	tokens: number;
	lastRefillAt: number;
	maxTokens: number;
	refillRate: number;
};

/**
 * Default rate limiter configuration
 * 3 burst capacity, 0.5 tokens per second (1 request every 2 seconds on average)
 */
export const DEFAULT_RATE_LIMITER_CONFIG = {
	maxTokens: INSTAGRAM_DEFAULTS.RATE_LIMIT_MAX_TOKENS,
	refillRate: INSTAGRAM_DEFAULTS.RATE_LIMIT_REFILL_RATE,
};

/**
 * Create initial rate limiter state
 */
export function createRateLimiterState(
	maxTokens: number = DEFAULT_RATE_LIMITER_CONFIG.maxTokens,
	refillRate: number = DEFAULT_RATE_LIMITER_CONFIG.refillRate,
): RateLimiterState {
	return {
		tokens: maxTokens,
		lastRefillAt: Date.now(),
		maxTokens,
		refillRate,
	};
}

/**
 * Refill tokens based on elapsed time
 * Returns updated state
 */
export function refillTokens(state: RateLimiterState): RateLimiterState {
	const now = Date.now();
	const elapsedSeconds = (now - state.lastRefillAt) / 1000;
	const tokensToAdd = elapsedSeconds * state.refillRate;
	const newTokens = Math.min(state.maxTokens, state.tokens + tokensToAdd);

	return {
		...state,
		tokens: newTokens,
		lastRefillAt: now,
	};
}

/**
 * Try to consume tokens from the bucket
 * Returns { success: true, state } if tokens available
 * Returns { success: false, waitMs, state } if need to wait
 */
export function tryConsumeToken(
	state: RateLimiterState,
	tokensNeeded: number = 1,
):
	| { success: true; state: RateLimiterState }
	| { success: false; waitMs: number; state: RateLimiterState } {
	// First refill based on elapsed time
	const refilledState = refillTokens(state);

	if (refilledState.tokens >= tokensNeeded) {
		// Enough tokens available
		return {
			success: true,
			state: {
				...refilledState,
				tokens: refilledState.tokens - tokensNeeded,
			},
		};
	}

	// Calculate wait time
	const tokensShort = tokensNeeded - refilledState.tokens;
	const waitMs = (tokensShort / refilledState.refillRate) * 1000;

	return {
		success: false,
		waitMs: Math.ceil(waitMs),
		state: refilledState,
	};
}

/**
 * In-memory rate limiter class for use within a single action
 * For persistent rate limiting across actions, use @convex-dev/rate-limiter
 */
export class InMemoryRateLimiter {
	private state: RateLimiterState;

	constructor(
		maxTokens: number = DEFAULT_RATE_LIMITER_CONFIG.maxTokens,
		refillRate: number = DEFAULT_RATE_LIMITER_CONFIG.refillRate,
	) {
		this.state = createRateLimiterState(maxTokens, refillRate);
	}

	/**
	 * Wait for and consume a token
	 * Returns the wait time in ms (0 if no wait needed)
	 */
	async consumeToken(): Promise<number> {
		const result = tryConsumeToken(this.state);

		if (result.success) {
			this.state = result.state;
			return 0;
		}

		// Wait and retry
		await new Promise((resolve) => setTimeout(resolve, result.waitMs));
		this.state = result.state;

		// After waiting, try again (should succeed now)
		const retryResult = tryConsumeToken(this.state);
		if (retryResult.success) {
			this.state = retryResult.state;
		}

		return result.waitMs;
	}

	/**
	 * Get current state (for persistence)
	 */
	getState(): RateLimiterState {
		return { ...this.state };
	}

	/**
	 * Restore state (from persistence)
	 */
	restoreState(state: RateLimiterState): void {
		this.state = { ...state };
	}
}
