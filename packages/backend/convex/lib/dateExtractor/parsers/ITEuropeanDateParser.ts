/**
 * European date format parser for chrono-node
 * Handles DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY formats
 * Also handles abbreviated patterns like "DOM. 01/02" (Domenica 1 Febbraio)
 */

import type { ParsingContext, Parser } from "chrono-node";
import type { ParsingComponents, ParsingResult } from "chrono-node";

/**
 * Pattern matches European date formats:
 * - 01/02/2026 (DD/MM/YYYY)
 * - 01/02 (DD/MM - year inferred)
 * - 8.3.2026 (D.M.YYYY)
 * - 8.3 (D.M - year inferred)
 * - 01-02-2026 (DD-MM-YYYY)
 * 
 * Optionally preceded by Italian weekday abbreviations:
 * - DOM. 01/02 (Domenica)
 * - SAB. 15/03 (Sabato)
 * - LUN 22/04 (Lunedì)
 */
const PATTERN =
	/(?:(?:DOM|LUN|MAR|MER|GIO|VEN|SAB)\.?\s*)?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/i;

const WEEKDAY_GROUP = 0; // Full match includes weekday
const DAY_GROUP = 1;
const MONTH_GROUP = 2;
const YEAR_GROUP = 3;

export default class ITEuropeanDateParser implements Parser {
	pattern(): RegExp {
		return PATTERN;
	}

	extract(
		context: ParsingContext,
		match: RegExpMatchArray,
	): ParsingComponents | ParsingResult | null {
		const day = Number.parseInt(match[DAY_GROUP], 10);
		const month = Number.parseInt(match[MONTH_GROUP], 10);
		let year = match[YEAR_GROUP]
			? Number.parseInt(match[YEAR_GROUP], 10)
			: context.refDate.getFullYear();

		// Validate day and month ranges
		if (day < 1 || day > 31) return null;
		if (month < 1 || month > 12) return null;

		// Handle 2-digit years
		if (year < 100) {
			year += year < 50 ? 2000 : 1900;
		}

		// Sanity check: if parsing would give us a date in distant past/future
		// without explicit year, adjust
		if (!match[YEAR_GROUP]) {
			const tentativeDate = new Date(year, month - 1, day);
			const refDate = context.refDate;
			const diffMs = tentativeDate.getTime() - refDate.getTime();
			const diffDays = diffMs / (1000 * 60 * 60 * 24);

			// If date is more than 6 months in the past, assume next year
			if (diffDays < -180) {
				year += 1;
			}
		}

		const result = context.createParsingResult(
			match.index ?? 0,
			match[0],
		);

		result.start.assign("day", day);
		result.start.assign("month", month);
		result.start.assign("year", year);
		result.start.imply("hour", 12);

		return result;
	}
}
