import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatDateShort,
	formatEventDate,
	formatEventDateRange,
	formatEventTime,
	formatTimestampForAI,
	formatTimestampForLog,
	isFuture,
	isPast,
	isToday,
	millisecondsToSeconds,
	now,
	secondsToMilliseconds,
} from "./dateUtils";

describe("secondsToMilliseconds", () => {
	it("converts seconds to milliseconds", () => {
		expect(secondsToMilliseconds(1)).toBe(1000);
		expect(secondsToMilliseconds(60)).toBe(60000);
		expect(secondsToMilliseconds(0)).toBe(0);
	});

	it("handles large values", () => {
		expect(secondsToMilliseconds(86400)).toBe(86400000); // 1 day
		expect(secondsToMilliseconds(604800)).toBe(604800000); // 1 week
	});

	it("handles decimal values", () => {
		expect(secondsToMilliseconds(1.5)).toBe(1500);
		expect(secondsToMilliseconds(0.5)).toBe(500);
	});
});

describe("millisecondsToSeconds", () => {
	it("converts milliseconds to seconds with floor", () => {
		expect(millisecondsToSeconds(1000)).toBe(1);
		expect(millisecondsToSeconds(1500)).toBe(1);
		expect(millisecondsToSeconds(999)).toBe(0);
	});

	it("handles large values", () => {
		expect(millisecondsToSeconds(86400000)).toBe(86400);
		expect(millisecondsToSeconds(604800000)).toBe(604800);
	});

	it("floors the result", () => {
		expect(millisecondsToSeconds(1999)).toBe(1);
		expect(millisecondsToSeconds(2001)).toBe(2);
	});
});

describe("now", () => {
	it("returns current timestamp in milliseconds", () => {
		const before = Date.now();
		const result = now();
		const after = Date.now();

		expect(result).toBeGreaterThanOrEqual(before);
		expect(result).toBeLessThanOrEqual(after);
	});
});

describe("formatTimestampForAI", () => {
	it("formats timestamp in Italian locale with time", () => {
		// Fixed timestamp: 2024-03-15 10:30:00 UTC
		const timestamp = 1710499800000;
		const formatted = formatTimestampForAI(timestamp);

		// Should contain year
		expect(formatted).toContain("2024");
		// Should contain month in Italian
		expect(formatted).toContain("marzo");
		// Should contain time (in Europe/Rome timezone, this is 11:30)
		expect(formatted).toMatch(/\d{2}:\d{2}/);
	});

	it("includes weekday", () => {
		// 2024-03-15 is a Friday (venerdì in Italian)
		const timestamp = 1710499800000;
		const formatted = formatTimestampForAI(timestamp);
		expect(formatted).toContain("venerdì");
	});
});

describe("formatEventDate", () => {
	it("formats date without time", () => {
		// 2024-03-15 10:30:00 UTC
		const timestamp = 1710499800000;
		const formatted = formatEventDate(timestamp);

		expect(formatted).toContain("2024");
		expect(formatted).toContain("marzo");
		expect(formatted).toContain("15");
		// Should not contain time
		expect(formatted).not.toMatch(/\d{2}:\d{2}/);
	});

	it("includes weekday", () => {
		// 2024-03-15 is a Friday
		const timestamp = 1710499800000;
		const formatted = formatEventDate(timestamp);
		expect(formatted).toContain("venerdì");
	});
});

describe("formatEventDateRange", () => {
	it("returns empty string for undefined start", () => {
		expect(formatEventDateRange(undefined)).toBe("");
	});

	it("returns single date when end is undefined", () => {
		const date = 1710499800000;
		const result = formatEventDateRange(date, undefined);
		expect(result).not.toContain("dal");
		expect(result).toContain("marzo");
	});

	it("returns single date when end equals start", () => {
		const date = 1710499800000;
		const result = formatEventDateRange(date, date);
		expect(result).not.toContain("dal");
		expect(result).toContain("marzo");
	});

	it("returns range when dates differ", () => {
		const start = 1710499800000; // 2024-03-15
		const end = 1710586200000; // 2024-03-16 (approximately +1 day)
		const result = formatEventDateRange(start, end);
		expect(result).toContain("dal");
		expect(result).toContain("al");
	});
});

describe("formatEventTime", () => {
	it("returns empty string for undefined start", () => {
		expect(formatEventTime(undefined)).toBe("");
	});

	it("returns single time when only start provided", () => {
		expect(formatEventTime("17:00")).toBe("17:00");
	});

	it("returns time range when both start and end provided", () => {
		const result = formatEventTime("17:00", "20:00");
		expect(result).toBe("dalle 17:00 alle 20:00");
	});
});

describe("formatTimestampForLog", () => {
	it("formats timestamp with full date and time", () => {
		// 2024-03-15 10:30:00 UTC
		const timestamp = 1710499800000;
		const formatted = formatTimestampForLog(timestamp);

		expect(formatted).toContain("2024");
		expect(formatted).toContain("marzo");
		// Should contain time
		expect(formatted).toMatch(/\d{2}:\d{2}/);
	});
});

describe("formatDateShort", () => {
	it("formats date without weekday", () => {
		// 2024-03-15 10:30:00 UTC
		const timestamp = 1710499800000;
		const formatted = formatDateShort(timestamp);

		expect(formatted).toContain("2024");
		expect(formatted).toContain("marzo");
		expect(formatted).toContain("15");
		// Should not contain weekday
		expect(formatted).not.toContain("venerdì");
	});
});

describe("isPast/isFuture/isToday", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("isPast", () => {
		it("returns true for past timestamps", () => {
			const pastTime = new Date("2024-03-14T12:00:00Z").getTime();
			expect(isPast(pastTime)).toBe(true);
		});

		it("returns false for future timestamps", () => {
			const futureTime = new Date("2024-03-16T12:00:00Z").getTime();
			expect(isPast(futureTime)).toBe(false);
		});

		it("returns true for timestamps just before now", () => {
			const justBefore = new Date("2024-03-15T11:59:59Z").getTime();
			expect(isPast(justBefore)).toBe(true);
		});
	});

	describe("isFuture", () => {
		it("returns true for future timestamps", () => {
			const futureTime = new Date("2024-03-16T12:00:00Z").getTime();
			expect(isFuture(futureTime)).toBe(true);
		});

		it("returns false for past timestamps", () => {
			const pastTime = new Date("2024-03-14T12:00:00Z").getTime();
			expect(isFuture(pastTime)).toBe(false);
		});

		it("returns true for timestamps just after now", () => {
			const justAfter = new Date("2024-03-15T12:00:01Z").getTime();
			expect(isFuture(justAfter)).toBe(true);
		});
	});

	describe("isToday", () => {
		it("returns true for timestamps on the same day", () => {
			// 2024-03-15 in Europe/Rome timezone
			const sameDay = new Date("2024-03-15T08:00:00Z").getTime();
			expect(isToday(sameDay)).toBe(true);
		});

		it("returns false for timestamps on different days", () => {
			const differentDay = new Date("2024-03-14T12:00:00Z").getTime();
			expect(isToday(differentDay)).toBe(false);
		});

		it("handles timezone correctly for Europe/Rome", () => {
			// At midnight UTC on March 15, it's 1am in Rome, so still March 15
			const midnightUtc = new Date("2024-03-15T00:00:00Z").getTime();
			expect(isToday(midnightUtc)).toBe(true);
		});
	});
});
