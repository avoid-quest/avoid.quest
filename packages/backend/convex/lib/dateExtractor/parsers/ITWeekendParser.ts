/**
 * Italian weekend parser for chrono-node
 * Handles patterns like "questo weekend", "fine settimana", "questo fine settimana"
 */

import type {
	Parser,
	ParsingComponents,
	ParsingContext,
	ParsingResult,
} from "chrono-node";

/**
 * Pattern matches:
 * - "weekend" / "week-end" / "week end"
 * - "fine settimana" / "finesettimana"
 * - "questo weekend" / "questo fine settimana"
 * - "prossimo weekend" / "prossimo fine settimana"
 * - "scorso weekend" / "scorso fine settimana"
 */
const PATTERN =
	/(^|\W)((?:questo|prossimo|scorso|il)\s*)?(?:week[\s-]?end|fine[\s]?settimana)(?=\W|$)/i;

const MODIFIER_GROUP = 2;

export default class ITWeekendParser implements Parser {
	pattern(): RegExp {
		return PATTERN;
	}

	extract(
		context: ParsingContext,
		match: RegExpMatchArray,
	): ParsingComponents | ParsingResult | null {
		// Adjust match index for the boundary character
		const boundaryLength = match[1]?.length ?? 0;
		const adjustedIndex = (match.index ?? 0) + boundaryLength;

		const modifier = (match[MODIFIER_GROUP] || "").toLowerCase().trim();
		const refDate = context.refDate;

		// Calculate the upcoming Saturday
		const dayOfWeek = refDate.getDay(); // 0 = Sunday, 6 = Saturday
		let daysUntilSaturday = (6 - dayOfWeek) % 7;

		// Handle modifiers
		if (modifier === "scorso") {
			// Last weekend
			daysUntilSaturday = daysUntilSaturday - 7;
			if (daysUntilSaturday >= 0) {
				daysUntilSaturday -= 7;
			}
		} else if (modifier === "prossimo") {
			// Next weekend (ensure it's in the future)
			if (daysUntilSaturday <= 0) {
				daysUntilSaturday += 7;
			}
		} else {
			// "questo" or no modifier - this weekend
			// If today is Sunday, "questo weekend" means today
			if (dayOfWeek === 0) {
				daysUntilSaturday = -1; // Saturday was yesterday
			} else if (daysUntilSaturday === 0) {
				// Today is Saturday
				daysUntilSaturday = 0;
			}
		}

		// Calculate Saturday date
		const saturday = new Date(refDate);
		saturday.setDate(saturday.getDate() + daysUntilSaturday);
		saturday.setHours(12, 0, 0, 0);

		// Calculate Sunday date
		const sunday = new Date(saturday);
		sunday.setDate(sunday.getDate() + 1);

		// Create result with range (Saturday to Sunday)
		const result = context.createParsingResult(adjustedIndex, match[0].trim());

		result.start.assign("day", saturday.getDate());
		result.start.assign("month", saturday.getMonth() + 1);
		result.start.assign("year", saturday.getFullYear());
		result.start.imply("hour", 12);

		result.end = context.createParsingComponents();
		result.end.assign("day", sunday.getDate());
		result.end.assign("month", sunday.getMonth() + 1);
		result.end.assign("year", sunday.getFullYear());
		result.end.imply("hour", 23);

		return result;
	}
}
