/**
 * Centralized date utilities for timestamp handling
 *
 * All timestamps in this module are in MILLISECONDS (JavaScript standard).
 *
 * IMPORTANT: All timestamp parameters and return values are in milliseconds.
 * Use secondsToMilliseconds() when receiving timestamps from external APIs
 * that use seconds (e.g., Instagram API).
 */

const MS_PER_SECOND = 1000;
const TIMEZONE = "Europe/Rome";
const LOCALE = "it-IT";

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
 * This is the standard way to get the current time.
 * Always use this instead of Date.now() for consistency.
 *
 * @returns Current timestamp in milliseconds (UTC)
 */
export function now(): number {
  return Date.now();
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
  const date = new Date(timestamp);
  return date.toLocaleString(LOCALE, {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
}
