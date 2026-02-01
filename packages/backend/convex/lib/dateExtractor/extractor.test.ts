import { describe, expect, it } from "vitest";
import {
	extractAllDates,
	extractEventDate,
	getEventDateRange,
	getEventTimestamp,
} from "./extractor";

// Fixed reference date for consistent tests: January 15, 2026, Wednesday, 14:00 UTC
const REF_DATE = new Date("2026-01-15T14:00:00.000Z");
const REF_TIMESTAMP = REF_DATE.getTime();

describe("extractEventDate", () => {
	describe("Italian casual dates", () => {
		it("extracts 'oggi' (today)", () => {
			const result = extractEventDate("Evento oggi alle 21!", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date).not.toBeNull();
			expect(result.date?.matchedText.toLowerCase()).toContain("oggi");

			// Should be same day as reference
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(REF_DATE.getDate());
		});

		it("extracts 'domani' (tomorrow)", () => {
			const result = extractEventDate("Ci vediamo domani sera", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(16); // Jan 16
		});

		it("extracts 'stasera' (tonight)", () => {
			const result = extractEventDate("Stasera grande festa!", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date?.matchedText.toLowerCase()).toContain("stasera");
		});

		it("extracts 'questa sera' (this evening)", () => {
			const result = extractEventDate("Vi aspettiamo questa sera", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
		});
	});

	describe("Italian weekdays", () => {
		it("extracts 'venerdì' (Friday)", () => {
			const result = extractEventDate("Evento venerdì", {
				referenceDate: REF_DATE,
				forwardDate: true,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDay()).toBe(5); // Friday
		});

		it("extracts 'sabato' with modifier 'prossimo'", () => {
			const result = extractEventDate("Ci vediamo sabato prossimo", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDay()).toBe(6); // Saturday
		});
	});

	describe("Italian explicit dates", () => {
		it("extracts '15 gennaio' format", () => {
			const result = extractEventDate("Evento il 20 gennaio 2026", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(20);
			expect(extracted.getMonth()).toBe(0); // January
		});

		it("extracts slash format '15/01'", () => {
			const result = extractEventDate("Appuntamento il 20/01", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(20);
		});
	});

	describe("Italian weekend patterns (custom parser)", () => {
		it("extracts 'questo weekend'", () => {
			const result = extractEventDate("Festa questo weekend!", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date?.isRange).toBe(true);

			// Weekend should be Saturday-Sunday
			const start = new Date(result.date?.start);
			const end = new Date(result.date?.end);
			expect(start.getDay()).toBe(6); // Saturday
			expect(end.getDay()).toBe(0); // Sunday
		});

		it("extracts 'fine settimana'", () => {
			const result = extractEventDate("Ci vediamo il fine settimana", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date?.isRange).toBe(true);
		});

		it("extracts 'prossimo weekend'", () => {
			const result = extractEventDate("Evento prossimo weekend", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
		});
	});

	describe("English dates", () => {
		it("extracts 'tonight'", () => {
			const result = extractEventDate("Party tonight at 9pm!", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			// Locale detection is best-effort metadata
			expect(["en", "unknown"]).toContain(result.date?.locale);
		});

		it("extracts 'tomorrow'", () => {
			const result = extractEventDate("See you tomorrow", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(16);
		});

		it("extracts 'this weekend'", () => {
			const result = extractEventDate("Event this weekend", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
		});

		it("extracts 'January 20'", () => {
			const result = extractEventDate("Event on January 20, 2026", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			const extracted = new Date(result.date?.start);
			expect(extracted.getDate()).toBe(20);
			expect(extracted.getMonth()).toBe(0);
		});
	});

	describe("fallback behavior", () => {
		it("returns fallback when no date found", () => {
			const result = extractEventDate("Just a normal post with no dates", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(false);
			expect(result.date).toBeNull();
			expect(result.fallback).toBe(REF_TIMESTAMP);
		});

		it("uses post timestamp as fallback", () => {
			const postTimestamp = new Date("2026-01-10T10:00:00Z").getTime();
			const result = extractEventDate("No date here", {
				referenceDate: postTimestamp,
			});

			expect(result.found).toBe(false);
			expect(result.fallback).toBe(postTimestamp);
		});
	});

	describe("locale priority", () => {
		it("prefers Italian by default", () => {
			// "sera" could be matched by both, but Italian should take priority
			const result = extractEventDate("questa sera", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date?.locale).toBe("it");
		});

		it("falls back to English when Italian fails", () => {
			const result = extractEventDate("next Monday", {
				referenceDate: REF_DATE,
			});

			expect(result.found).toBe(true);
			expect(result.date?.locale).toBe("en");
		});
	});
});

describe("extractAllDates", () => {
	it("extracts multiple dates from text", () => {
		const result = extractAllDates(
			"Prima data: domani. Seconda data: 20 gennaio.",
			{ referenceDate: REF_DATE },
		);

		expect(result.length).toBeGreaterThanOrEqual(2);
	});

	it("returns empty array when no dates", () => {
		const result = extractAllDates("No dates here", {
			referenceDate: REF_DATE,
		});

		expect(result).toEqual([]);
	});
});

describe("getEventTimestamp", () => {
	it("returns extracted date when found", () => {
		const timestamp = getEventTimestamp("Evento domani", REF_TIMESTAMP);

		// Should be Jan 16
		const date = new Date(timestamp);
		expect(date.getDate()).toBe(16);
	});

	it("returns post timestamp when no date found", () => {
		const timestamp = getEventTimestamp("No date", REF_TIMESTAMP);

		expect(timestamp).toBe(REF_TIMESTAMP);
	});
});

describe("getEventDateRange", () => {
	it("returns range for weekend patterns", () => {
		const range = getEventDateRange("Evento questo weekend", REF_TIMESTAMP);

		expect(range).not.toBeNull();
		expect(range?.end).toBeGreaterThan(range?.start);
	});

	it("returns same start/end for single dates", () => {
		const range = getEventDateRange("Evento domani", REF_TIMESTAMP);

		expect(range).not.toBeNull();
		// For single dates, start and end should be the same
		expect(range?.start).toBe(range?.end);
	});

	it("returns null when no date found", () => {
		const range = getEventDateRange("No date here", REF_TIMESTAMP);

		expect(range).toBeNull();
	});
});

describe("real-world Instagram captions", () => {
	it("handles typical Italian event caption", () => {
		const caption = `🎉 GRANDE EVENTO 🎉
		
Vi aspettiamo STASERA dalle 22:00!
Ingresso libero, drink speciali.

📍 Club XYZ, Milano
#party #milano #nightlife`;

		const result = extractEventDate(caption, { referenceDate: REF_DATE });

		expect(result.found).toBe(true);
		expect(result.date?.matchedText.toLowerCase()).toContain("stasera");
	});

	it("handles date in middle of text", () => {
		const caption = `Nuovo evento! 🔥
		
Non perdete l'appuntamento di sabato 18 gennaio!
Prenotazioni aperte.

Link in bio`;

		const result = extractEventDate(caption, { referenceDate: REF_DATE });

		expect(result.found).toBe(true);
	});

	it("handles mixed language caption", () => {
		const caption = `International DJ Night 🎧
		
This Saturday @ Club Roma
Sabato notte con i migliori DJ!

#djset #roma`;

		const result = extractEventDate(caption, { referenceDate: REF_DATE });

		expect(result.found).toBe(true);
	});
});
