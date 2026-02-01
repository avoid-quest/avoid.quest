/**
 * Event date extraction from Instagram captions
 *
 * Uses chrono-node with Italian and English locales,
 * plus custom parsers for patterns like "questo weekend"
 */

import type { ParsedResult } from "chrono-node";
import * as chrono from "chrono-node";
import { ITEuropeanDateParser, ITWeekendParser } from "./parsers";
import type { ExtractedDate, ExtractionResult, ExtractOptions } from "./types";

// Create Italian parser with custom parsers
const italianParser = chrono.it.casual.clone();
// Add European date format parser FIRST (higher priority than built-in slash parser)
italianParser.parsers.unshift(new ITEuropeanDateParser());
// Add weekend parser for "questo weekend", "fine settimana", etc.
italianParser.parsers.push(new ITWeekendParser());

// English parser (casual mode for "tonight", "this weekend", etc.)
const englishParser = chrono.en.casual;

/**
 * Default extraction options
 */
const DEFAULT_OPTIONS: Required<ExtractOptions> = {
	referenceDate: new Date(),
	timezone: "Europe/Rome",
	forwardDate: true,
	localePriority: ["it", "en"],
};

/**
 * Convert a Date to milliseconds timestamp
 */
function toTimestamp(date: Date | number): number {
	return date instanceof Date ? date.getTime() : date;
}

/**
 * Detect locale of matched text based on common patterns
 */
function detectLocale(text: string): "it" | "en" | "unknown" {
	const lowerText = text.toLowerCase();

	// Italian patterns - more specific first
	const italianPatterns = [
		/\b(oggi|domani|ieri|stasera|questa\s*sera|settimana|mese|anno|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|prossimo|prossima|scorso|scorsa|questo|questa|fine\s*settimana|week[\s-]?end)\b/i,
	];

	// English patterns
	const englishPatterns = [
		/\b(today|tomorrow|yesterday|tonight|this\s+weekend|next\s+weekend|last\s+weekend|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|last|this)\b/i,
	];

	for (const pattern of italianPatterns) {
		if (pattern.test(lowerText)) return "it";
	}

	for (const pattern of englishPatterns) {
		if (pattern.test(lowerText)) return "en";
	}

	return "unknown";
}

/**
 * Parse text with a specific locale parser
 */
function parseWithLocale(
	text: string,
	locale: "it" | "en",
	refDate: Date,
	forwardDate: boolean,
): ParsedResult[] {
	const parser = locale === "it" ? italianParser : englishParser;
	return parser.parse(text, refDate, { forwardDate });
}

/**
 * Convert chrono ParsedResult to our ExtractedDate format
 */
function toExtractedDate(result: ParsedResult): ExtractedDate {
	const startDate = result.start.date();
	const endDate = result.end?.date() ?? startDate;

	return {
		start: startDate.getTime(),
		end: endDate.getTime(),
		matchedText: result.text,
		index: result.index,
		isRange: result.end !== undefined && result.end !== null,
		locale: detectLocale(result.text),
	};
}

/**
 * Check if a match looks like a duration rather than an event date
 * Durations like "due anni", "tre mesi", "una settimana" in narrative context
 * should not be interpreted as event dates
 */
function isDurationPattern(matchedText: string): boolean {
	const lowerText = matchedText.toLowerCase().trim();

	// Italian duration patterns (when used as narrative, not as event dates)
	// "due anni" (two years), "tre mesi" (three months), etc.
	const durationPatterns = [
		/^(un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s*(ann[oi]|mes[ei]|settiman[ae]|giorn[oi])$/i,
		// Also catch "circa due anni", "quasi tre mesi"
		/^(circa|quasi|oltre|più di|meno di)?\s*(un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s*(ann[oi]|mes[ei]|settiman[ae]|giorn[oi])$/i,
	];

	for (const pattern of durationPatterns) {
		if (pattern.test(lowerText)) {
			return true;
		}
	}

	return false;
}

/**
 * Score a parsed result to determine how likely it is to be an actual event date
 * Higher score = more likely to be an event date
 */
function scoreEventDate(result: ParsedResult): number {
	let score = 0;
	const text = result.text.toLowerCase();

	// Explicit day + month is very likely an event date
	const hasDay = result.start.isCertain("day");
	const hasMonth = result.start.isCertain("month");
	const hasWeekday = result.start.isCertain("weekday");

	if (hasDay && hasMonth) score += 100; // "29 gennaio", "15/02"
	if (hasWeekday && hasDay) score += 80; // "giovedì 29"
	if (hasWeekday) score += 50; // "giovedì", "sabato"
	if (hasMonth) score += 30; // month mentioned

	// Event-related keywords boost score
	const eventKeywords = [
		"h\\s*\\d", // "h 18:30", "h18"
		"ore\\s*\\d", // "ore 21"
		"alle\\s*\\d", // "alle 21"
		"dalle\\s*\\d", // "dalle 18"
	];
	for (const kw of eventKeywords) {
		if (new RegExp(kw, "i").test(text)) {
			score += 20;
		}
	}

	// Penalize pure duration patterns heavily
	if (isDurationPattern(result.text)) {
		score -= 200;
	}

	return score;
}

/**
 * Filter and sort parsed results to find the best event date
 */
function selectBestEventDate(results: ParsedResult[]): ParsedResult | null {
	if (results.length === 0) return null;

	// Filter out clear duration patterns
	const filtered = results.filter((r) => !isDurationPattern(r.text));

	if (filtered.length === 0) {
		// All results were durations, fall back to original results
		// but still try to find the best one
		const scored = results
			.map((r) => ({ result: r, score: scoreEventDate(r) }))
			.filter((s) => s.score > -100) // Filter out heavily penalized
			.sort((a, b) => b.score - a.score);
		return scored[0]?.result ?? null;
	}

	// Score remaining results and pick the best
	const scored = filtered
		.map((r) => ({ result: r, score: scoreEventDate(r) }))
		.sort((a, b) => b.score - a.score);

	return scored[0]?.result ?? filtered[0];
}

/**
 * Extract event date from Instagram caption text
 *
 * @param caption - The Instagram post caption
 * @param options - Extraction options
 * @returns Extraction result with date info or fallback
 *
 * @example
 * ```ts
 * const result = extractEventDate("Evento stasera alle 21!", {
 *   referenceDate: postTimestamp,
 * });
 *
 * if (result.found) {
 *   console.log(result.date.start); // timestamp in ms
 * }
 * ```
 */
export function extractEventDate(
	caption: string,
	options?: ExtractOptions,
): ExtractionResult {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const refDate =
		opts.referenceDate instanceof Date
			? opts.referenceDate
			: new Date(opts.referenceDate);
	const fallbackTimestamp = toTimestamp(opts.referenceDate);

	// Collect all results from all locales
	const allResults: ParsedResult[] = [];

	for (const locale of opts.localePriority) {
		const results = parseWithLocale(caption, locale, refDate, opts.forwardDate);
		allResults.push(...results);
	}

	// Select the best event date (filters durations, prefers explicit dates)
	const bestResult = selectBestEventDate(allResults);

	if (bestResult) {
		return {
			found: true,
			date: toExtractedDate(bestResult),
			fallback: fallbackTimestamp,
		};
	}

	// No date found - return fallback
	return {
		found: false,
		date: null,
		fallback: fallbackTimestamp,
	};
}

/**
 * Extract all dates from caption (useful for debugging/analysis)
 *
 * @param caption - The Instagram post caption
 * @param options - Extraction options
 * @returns Array of all extracted dates
 */
export function extractAllDates(
	caption: string,
	options?: ExtractOptions,
): ExtractedDate[] {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const refDate =
		opts.referenceDate instanceof Date
			? opts.referenceDate
			: new Date(opts.referenceDate);

	const allResults: ExtractedDate[] = [];
	const seenIndices = new Set<number>();

	for (const locale of opts.localePriority) {
		const results = parseWithLocale(caption, locale, refDate, opts.forwardDate);

		for (const result of results) {
			// Avoid duplicates from different locales matching the same text
			if (!seenIndices.has(result.index)) {
				seenIndices.add(result.index);
				allResults.push(toExtractedDate(result));
			}
		}
	}

	// Sort by position in text
	return allResults.sort((a, b) => a.index - b.index);
}

/**
 * Get the effective event date (extracted or fallback)
 *
 * Convenience function that always returns a timestamp.
 *
 * @param caption - The Instagram post caption
 * @param postTimestamp - The Instagram post timestamp (milliseconds)
 * @returns Event date timestamp in milliseconds
 */
export function getEventTimestamp(
	caption: string,
	postTimestamp: number,
): number {
	const result = extractEventDate(caption, {
		referenceDate: postTimestamp,
	});

	return result.found && result.date ? result.date.start : result.fallback;
}

/**
 * Get event date range (for posts with date ranges like "15-17 gennaio")
 *
 * @param caption - The Instagram post caption
 * @param postTimestamp - The Instagram post timestamp (milliseconds)
 * @returns Object with start and end timestamps, or null if no date found
 */
export function getEventDateRange(
	caption: string,
	postTimestamp: number,
): { start: number; end: number } | null {
	const result = extractEventDate(caption, {
		referenceDate: postTimestamp,
	});

	if (!result.found || !result.date) {
		return null;
	}

	return {
		start: result.date.start,
		end: result.date.end,
	};
}
