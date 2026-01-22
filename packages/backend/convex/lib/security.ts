/**
 * Security utilities for HTTP handlers
 */

import { createLogger } from "./logger";

const logger = createLogger("security");

/**
 * Timing-safe string comparison using Web Crypto API
 * Uses HMAC comparison to ensure constant-time operation,
 * preventing attackers from inferring secret values through response timing.
 *
 * Works in Convex's default runtime (no Node.js required).
 */
export async function secureCompare(a: string, b: string): Promise<boolean> {
	try {
		const encoder = new TextEncoder();

		// Use a fixed key for HMAC - we only care about equality, not the actual MAC
		const keyData = encoder.encode("timing-safe-compare-key");
		const key = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);

		// Compute HMAC of both strings
		const [macA, macB] = await Promise.all([
			crypto.subtle.sign("HMAC", key, encoder.encode(a)),
			crypto.subtle.sign("HMAC", key, encoder.encode(b)),
		]);

		// Compare the MACs byte-by-byte (constant time since HMAC lengths are always equal)
		const viewA = new Uint8Array(macA);
		const viewB = new Uint8Array(macB);

		let result = 0;
		for (let i = 0; i < viewA.length; i++) {
			result |= viewA[i] ^ viewB[i];
		}
		return result === 0;
	} catch (error) {
		// Crypto operation failed - log error and return false as safe default
		logger.error(
			`secureCompare: Crypto operation failed - ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		return false;
	}
}

/**
 * Check if an origin is allowed for CORS
 * @param origin - The Origin header value (null for same-origin requests)
 * @param allowedOrigins - List of allowed origin URLs
 * @returns true if origin is allowed, false otherwise
 */
export function isOriginAllowed(
	origin: string | null,
	allowedOrigins: string[],
): boolean {
	// null origin = same-origin request, allow
	if (origin === null) {
		return true;
	}
	// Explicitly check for allowed origins (empty string is rejected)
	return allowedOrigins.includes(origin);
}
