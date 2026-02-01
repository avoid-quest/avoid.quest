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

/**
 * Multi-date extraction result
 */
export type MultiDateResult = {
	/** All extracted event dates (sorted chronologically) */
	dates: number[];
	/** Primary date for backward compatibility (first date or fallback) */
	primaryDate: number;
	/** Event period spanning all dates */
	period: { start: number; end: number } | null;
};

/**
 * Clean caption by removing time patterns and opening hours
 * This prevents false positives like "10.00–18.00" being parsed as dates
 */
function cleanCaptionForDateExtraction(caption: string): string {
	return (
		caption
			// Time ranges: 10.00–18.00, 18:30-22:00
			.replace(/\d{1,2}[.:]\d{2}\s*[–-]\s*\d{1,2}[.:]\d{2}/g, " ")
			// Weekday abbreviations + times: Mar.-Dom. 10.00, Lun-Ven 9:00
			.replace(
				/\b(lun|mar|mer|gio|ven|sab|dom)\.?\s*[–-]?\s*(lun|mar|mer|gio|ven|sab|dom)?\.?\s+\d{1,2}[.:]/gi,
				" ",
			)
			// Time mentions: h18:30, alle 21.00, ore 22
			.replace(/\b(h|ore|alle)\s*\d{1,2}([.:]\d{2})?/gi, " ")
	);
}

/**
 * Check if text should be blacklisted from date extraction
 */
function isBlacklistedDateText(text: string): boolean {
	const t = text.trim().toLowerCase();
	// Standalone months
	if (
		/^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s*$/.test(
			t,
		)
	) {
		return true;
	}
	// Duration patterns
	if (/^(un|due|tre|circa)?\s*(ann|mes|settiman)/i.test(t)) return true;
	// Pure times
	if (/^\d{1,2}[.:]\d{2}/.test(t)) return true;
	// Standalone weekday abbreviations
	if (/^(lun|mar|mer|gio|ven|sab|dom)\.?\s*$/.test(t)) return true;
	// Standalone years
	if (/^\d{4}\s*$/.test(t)) return true;
	return false;
}

/**
 * Extract ALL event dates from a caption (for multi-event posts)
 *
 * This function handles:
 * - Multiple events in same post (e.g., "GIOVEDÌ 22" and "GIOVEDÌ 29")
 * - Calendar-style posts with multiple dates
 * - European date formats (DD/MM/YYYY)
 * - Deadline patterns ("fino al 28/06/2026")
 *
 * @param caption - The Instagram post caption
 * @param postTimestamp - The Instagram post timestamp (milliseconds)
 * @returns MultiDateResult with all dates, primary date, and period
 *
 * @example
 * ```ts
 * const result = extractAllEventDates(
 *   "GIOVEDÌ 22 alle 18:30\nGIOVEDÌ 29 alle 18:30",
 *   postTimestamp
 * );
 * // result.dates = [timestamp_jan22, timestamp_jan29]
 * // result.primaryDate = timestamp_jan22
 * // result.period = { start: timestamp_jan22, end: timestamp_jan29 }
 * ```
 */
export function extractAllEventDates(
	caption: string,
	postTimestamp: number,
): MultiDateResult {
	const ref = new Date(postTimestamp);
	const dates: number[] = [];
	const seen = new Set<string>();

	const cleaned = cleanCaptionForDateExtraction(caption);

	// 1. Full pattern: weekday + number + month name
	// e.g., "domenica 8 febbraio", "sabato 21 marzo"
	const fullDatePattern =
		/(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/gi;

	for (const m of cleaned.matchAll(fullDatePattern)) {
		const result = italianParser.parse(m[0], ref, { forwardDate: true })[0];
		if (result) {
			const ts = result.start.date().getTime();
			const key = new Date(ts).toISOString().split("T")[0];
			if (!seen.has(key)) {
				seen.add(key);
				dates.push(ts);
			}
		}
	}

	// 2. Short pattern: weekday + number (use month context from caption)
	// e.g., "GIOVEDÌ 22", "GIOVEDÌ 29" with "GENNAIO" somewhere in text
	if (dates.length === 0) {
		const monthMatch = cleaned.match(
			/(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i,
		);
		const monthContext = monthMatch?.[0] ?? "";

		const shortPattern =
			/(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s+(\d{1,2})/gi;

		for (const m of cleaned.matchAll(shortPattern)) {
			let text = m[0];
			if (monthContext) {
				text += ` ${monthContext}`;
			}

			const result = italianParser.parse(text, ref, { forwardDate: true })[0];
			if (result) {
				const ts = result.start.date().getTime();
				const key = new Date(ts).toISOString().split("T")[0];
				if (!seen.has(key)) {
					seen.add(key);
					dates.push(ts);
				}
			}
		}
	}

	// 3. European date format: DD/MM/YYYY or DD.MM.YYYY
	const euroDatePattern = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g;

	for (const m of caption.matchAll(euroDatePattern)) {
		const day = Number.parseInt(m[1], 10);
		const month = Number.parseInt(m[2], 10);
		const year = Number.parseInt(m[3], 10);

		if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
			const date = new Date(year, month - 1, day, 12);
			const ts = date.getTime();
			const key = date.toISOString().split("T")[0];
			if (!seen.has(key)) {
				seen.add(key);
				dates.push(ts);
			}
		}
	}

	// 4. Chrono fallback for other patterns (only certain dates)
	const chronoResults = italianParser.parse(cleaned, ref, {
		forwardDate: true,
	});

	for (const r of chronoResults) {
		if (isBlacklistedDateText(r.text)) continue;
		if (!r.start.isCertain("day") || !r.start.isCertain("month")) continue;

		const ts = r.start.date().getTime();
		const key = new Date(ts).toISOString().split("T")[0];
		if (!seen.has(key)) {
			seen.add(key);
			dates.push(ts);
		}
	}

	// Sort chronologically
	dates.sort((a, b) => a - b);

	// Calculate period
	const period =
		dates.length > 0
			? {
					start: dates[0],
					end: dates[dates.length - 1],
				}
			: null;

	// Primary date is the first one, or fallback to post timestamp
	const primaryDate = dates[0] ?? postTimestamp;

	return {
		dates,
		primaryDate,
		period,
	};
}
