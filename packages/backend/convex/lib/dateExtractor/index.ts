/**
 * Date extraction module for Instagram captions
 *
 * Extracts event dates from post captions supporting both
 * Italian and English natural language dates.
 *
 * @module dateExtractor
 *
 * @example
 * ```ts
 * import { extractEventDate, getEventTimestamp } from "./lib/dateExtractor";
 *
 * // Full extraction with metadata
 * const result = extractEventDate("Evento stasera alle 21!", {
 *   referenceDate: post.timestamp,
 * });
 * if (result.found) {
 *   console.log(result.date.start); // timestamp in ms
 *   console.log(result.date.isRange); // true if date range
 * }
 *
 * // Simple timestamp extraction (with fallback to post timestamp)
 * const eventDate = getEventTimestamp(caption, post.timestamp);
 * ```
 */

export type { MultiDateResult } from "./extractor";
export {
	extractAllDates,
	extractAllEventDates,
	extractEventDate,
	getEventDateRange,
	getEventTimestamp,
} from "./extractor";

export type {
	ExtractedDate,
	ExtractionResult,
	ExtractOptions,
} from "./types";
