/**
 * Simple date utility functions using Intl.DateTimeFormat
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

/**
 * Formats a Unix timestamp (seconds) into a readable date string
 */
export function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp || timestamp <= 0) {
    return "Recently";
  }

  const date = new Date(timestamp * MILLISECONDS_PER_SECOND);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Formats a timestamp into a compact relative time string
 */
export function formatCompactDate(
  timestamp: number | null | undefined
): string {
  if (!timestamp || timestamp <= 0) {
    return "Recently";
  }

  const date = new Date(timestamp * MILLISECONDS_PER_SECOND);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const now = new Date();
  const diffInDays = Math.floor(
    (now.getTime() - date.getTime()) /
      (MILLISECONDS_PER_SECOND *
        SECONDS_PER_MINUTE *
        MINUTES_PER_HOUR *
        HOURS_PER_DAY)
  );

  if (diffInDays === 0) {
    return "Today";
  }
  if (diffInDays === 1) {
    return "Yesterday";
  }
  if (diffInDays < DAYS_PER_WEEK) {
    return `${diffInDays}d ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Formats a timestamp into a relative time string (e.g., "2h ago")
 */
export function formatRelativeTime(
  timestamp: number | null | undefined
): string {
  if (!timestamp || timestamp <= 0) {
    return "Recently";
  }

  const date = new Date(timestamp * MILLISECONDS_PER_SECOND);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const now = new Date();
  const diffInSeconds = Math.floor(
    (now.getTime() - date.getTime()) / MILLISECONDS_PER_SECOND
  );

  if (diffInSeconds < SECONDS_PER_MINUTE) {
    return "Just now";
  }
  if (diffInSeconds < SECONDS_PER_MINUTE * MINUTES_PER_HOUR) {
    return `${Math.floor(diffInSeconds / SECONDS_PER_MINUTE)}m ago`;
  }
  if (diffInSeconds < SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY) {
    return `${Math.floor(diffInSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR))}h ago`;
  }
  if (
    diffInSeconds <
    SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY * DAYS_PER_WEEK
  ) {
    return `${Math.floor(diffInSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY))}d ago`;
  }

  return formatTimestamp(timestamp);
}
