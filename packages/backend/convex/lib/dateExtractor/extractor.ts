/**
 * Event date extraction from Instagram captions
 *
 * Uses chrono-node with Italian and English locales,
 * plus custom parsers for patterns like "questo weekend"
 */

import * as chrono from "chrono-node";
import type { ParsedResult } from "chrono-node";
import { ITWeekendParser } from "./parsers";
import type {
	ExtractedDate,
	ExtractOptions,
	ExtractionResult,
} from "./types";

// Create Italian parser with custom weekend support
const italianParser = chrono.it.casual.clone();
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

	// Try each locale in priority order
	for (const locale of opts.localePriority) {
		const results = parseWithLocale(
			caption,
			locale,
			refDate,
			opts.forwardDate,
		);

		if (results.length > 0) {
			// Return the first result (earliest in text)
			const firstResult = results[0];
			return {
				found: true,
				date: toExtractedDate(firstResult),
				fallback: fallbackTimestamp,
			};
		}
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
		const results = parseWithLocale(
			caption,
			locale,
			refDate,
			opts.forwardDate,
		);

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
