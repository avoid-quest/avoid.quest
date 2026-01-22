import { describe, expect, it } from "vitest";
import { isOriginAllowed, secureCompare } from "./security";

describe("secureCompare", () => {
	describe("matching strings", () => {
		it("returns true for identical strings", async () => {
			expect(await secureCompare("secret123", "secret123")).toBe(true);
		});

		it("returns true for empty strings", async () => {
			expect(await secureCompare("", "")).toBe(true);
		});

		it("returns true for single character strings", async () => {
			expect(await secureCompare("a", "a")).toBe(true);
		});

		it("returns true for long identical strings", async () => {
			const longString = "a".repeat(1000);
			expect(await secureCompare(longString, longString)).toBe(true);
		});

		it("returns true for strings with special characters", async () => {
			expect(await secureCompare("!@#$%^&*()", "!@#$%^&*()")).toBe(true);
		});

		it("returns true for unicode strings", async () => {
			expect(await secureCompare("hello\u00A0world", "hello\u00A0world")).toBe(
				true,
			);
		});
	});

	describe("non-matching strings", () => {
		it("returns false for different strings of same length", async () => {
			expect(await secureCompare("secret123", "secret456")).toBe(false);
		});

		it("returns false for strings differing by one character", async () => {
			expect(await secureCompare("secret123", "secret124")).toBe(false);
		});

		it("returns false for case differences", async () => {
			expect(await secureCompare("Secret", "secret")).toBe(false);
		});
	});

	describe("different length strings", () => {
		it("returns false when first string is shorter", async () => {
			expect(await secureCompare("short", "longer")).toBe(false);
		});

		it("returns false when first string is longer", async () => {
			expect(await secureCompare("longer", "short")).toBe(false);
		});

		it("returns false when one string is empty", async () => {
			expect(await secureCompare("", "nonempty")).toBe(false);
			expect(await secureCompare("nonempty", "")).toBe(false);
		});

		it("returns false for prefix match", async () => {
			expect(await secureCompare("secret", "secret123")).toBe(false);
		});
	});
});

describe("isOriginAllowed", () => {
	const allowedOrigins = [
		"http://localhost:3000",
		"http://localhost:5173",
		"https://example.com",
	];

	describe("allowed origins", () => {
		it("returns true for null origin (same-origin request)", () => {
			expect(isOriginAllowed(null, allowedOrigins)).toBe(true);
		});

		it("returns true for allowed localhost origin", () => {
			expect(isOriginAllowed("http://localhost:3000", allowedOrigins)).toBe(
				true,
			);
		});

		it("returns true for allowed https origin", () => {
			expect(isOriginAllowed("https://example.com", allowedOrigins)).toBe(true);
		});

		it("returns true for any origin in the list", () => {
			for (const origin of allowedOrigins) {
				expect(isOriginAllowed(origin, allowedOrigins)).toBe(true);
			}
		});
	});

	describe("disallowed origins", () => {
		it("returns false for origin not in list", () => {
			expect(isOriginAllowed("https://evil.com", allowedOrigins)).toBe(false);
		});

		it("returns false for origin with different port", () => {
			expect(isOriginAllowed("http://localhost:8080", allowedOrigins)).toBe(
				false,
			);
		});

		it("returns false for origin with different protocol", () => {
			expect(isOriginAllowed("https://localhost:3000", allowedOrigins)).toBe(
				false,
			);
		});

		it("returns false for subdomain of allowed origin", () => {
			expect(isOriginAllowed("https://sub.example.com", allowedOrigins)).toBe(
				false,
			);
		});

		it("returns false for empty string origin", () => {
			// Empty string is truthy but not in list
			expect(isOriginAllowed("", allowedOrigins)).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("handles empty allowed origins list", () => {
			expect(isOriginAllowed("https://example.com", [])).toBe(false);
			expect(isOriginAllowed(null, [])).toBe(true);
		});

		it("is case sensitive", () => {
			expect(isOriginAllowed("HTTPS://EXAMPLE.COM", allowedOrigins)).toBe(
				false,
			);
		});
	});
});
