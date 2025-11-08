/**
 * Centralized date formatting and parsing utilities
 *
 * All timestamps in this module are in MILLISECONDS (JavaScript standard).
 * Timestamps are stored in UTC in the database (timezone-agnostic).
 * All display formatting uses Europe/Rome timezone with it-IT locale.
 *
 * IMPORTANT: All timestamp parameters and return values are in milliseconds.
 * Use secondsToMilliseconds() when receiving timestamps from external APIs
 * that use seconds (e.g., Instagram API).
 */

const TIMEZONE = "Europe/Rome";
const LOCALE = "it-IT";
const MS_PER_SECOND = 1000;

/**
 * Convert timestamp from seconds to milliseconds
 *
 * Use this when receiving timestamps from external APIs that use seconds
 * (e.g., Instagram API's taken_at_timestamp).
 *
 * @param seconds - Timestamp in seconds (Unix timestamp)
 * @returns Timestamp in milliseconds
 */
export function secondsToMilliseconds(seconds: number): number {
  return seconds * MS_PER_SECOND;
}

/**
 * Convert timestamp from milliseconds to seconds
 *
 * Use this only when sending timestamps to external APIs that expect seconds.
 * Internal code should always use milliseconds.
 *
 * @param milliseconds - Timestamp in milliseconds
 * @returns Timestamp in seconds (Unix timestamp)
 */
export function millisecondsToSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / MS_PER_SECOND);
}

/**
 * Get current timestamp in milliseconds (UTC)
 *
 * This is the standard way to get the current time in the backend.
 * Always use this instead of Date.now() for consistency.
 *
 * @returns Current timestamp in milliseconds (UTC)
 */
export function now(): number {
  return Date.now();
}

/**
 * Create Date object from timestamp in milliseconds
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns Date object representing the timestamp
 */
function createDate(timestamp: number): Date {
  return new Date(timestamp);
}

/**
 * Format timestamp for AI context (detailed Italian format with time)
 * Used in prompts to provide context to AI about when a post was published
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns Formatted date string in Europe/Rome timezone
 * @example "mercoledì 21 gennaio 1970 alle ore 10:06"
 */
export function formatTimestampForAI(timestamp: number): string {
  const date = createDate(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return date.toLocaleString(LOCALE, options);
}

/**
 * Format event date for display (date only, no time)
 * Used in Telegram messages and UI
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns Formatted date string in Europe/Rome timezone
 * @example "venerdì 15 marzo 2025"
 */
export function formatEventDate(timestamp: number): string {
  const date = createDate(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return date.toLocaleDateString(LOCALE, options);
}

/**
 * Format event date range for display
 *
 * @param dateStart - Start timestamp in milliseconds (UTC), optional
 * @param dateEnd - End timestamp in milliseconds (UTC), optional
 * @returns Formatted date range string in Europe/Rome timezone
 * @example "dal venerdì 15 marzo 2025 al domenica 17 marzo 2025"
 * @example "venerdì 15 marzo 2025" (if dateEnd is same as dateStart or undefined)
 */
export function formatEventDateRange(
  dateStart?: number,
  dateEnd?: number
): string {
  if (!dateStart) {
    return "";
  }
  if (dateEnd && dateEnd !== dateStart) {
    const startDate = formatEventDate(dateStart);
    const endDate = formatEventDate(dateEnd);
    return `dal ${startDate} al ${endDate}`;
  }
  return formatEventDate(dateStart);
}

/**
 * Format event time for display
 *
 * @example "dalle 17:00 alle 20:00"
 * @example "17:00" (if only timeStart)
 */
export function formatEventTime(timeStart?: string, timeEnd?: string): string {
  if (!timeStart) {
    return "";
  }
  if (timeEnd) {
    return `dalle ${timeStart} alle ${timeEnd}`;
  }
  return timeStart;
}

/**
 * Format timestamp for console/logging output (full date and time)
 * Used in scripts and debugging
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns Formatted date string in Europe/Rome timezone
 * @example "mercoledì 21 gennaio 1970, 10:06"
 */
export function formatTimestampForLog(timestamp: number): string {
  const date = createDate(timestamp);
  return date.toLocaleString(LOCALE, {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
}

/**
 * Format date for short display (no weekday)
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns Formatted date string in Europe/Rome timezone
 * @example "15 marzo 2025"
 */
export function formatDateShort(timestamp: number): string {
  const date = createDate(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return date.toLocaleDateString(LOCALE, options);
}

/**
 * Check if timestamp is in the past (compared to current time)
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns true if timestamp is before current time
 */
export function isPast(timestamp: number): boolean {
  return createDate(timestamp).getTime() < now();
}

/**
 * Check if timestamp is in the future (compared to current time)
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns true if timestamp is after current time
 */
export function isFuture(timestamp: number): boolean {
  return createDate(timestamp).getTime() > now();
}

/**
 * Check if timestamp is today in Europe/Rome timezone
 *
 * This function is timezone-aware and compares dates in the Europe/Rome timezone,
 * not the server's local timezone.
 *
 * @param timestamp - Timestamp in milliseconds (UTC)
 * @returns true if timestamp falls on today's date in Europe/Rome timezone
 */
export function isToday(timestamp: number): boolean {
  const date = createDate(timestamp);
  const nowDate = createDate(now());

  // Get date components in Europe/Rome timezone
  const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const dateParts = dateFormatter.formatToParts(date);
  const nowParts = dateFormatter.formatToParts(nowDate);

  const dateYear = dateParts.find((p) => p.type === "year")?.value;
  const dateMonth = dateParts.find((p) => p.type === "month")?.value;
  const dateDay = dateParts.find((p) => p.type === "day")?.value;

  const nowYear = nowParts.find((p) => p.type === "year")?.value;
  const nowMonth = nowParts.find((p) => p.type === "month")?.value;
  const nowDay = nowParts.find((p) => p.type === "day")?.value;

  return (
    dateYear === nowYear &&
    dateMonth === nowMonth &&
    dateDay === nowDay
  );
}
