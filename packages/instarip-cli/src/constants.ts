// Timing
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

// Rate limiting
export const DEFAULT_BURST_CAPACITY = 3;
export const DEFAULT_REQUESTS_PER_SECOND = 0.5;

// Delays
export const MIN_DELAY_MS = 2000;
export const MAX_DELAY_MS = 5000;
export const TIMEOUT_MS = 30_000;
export const POST_PROCESSING_DELAY_MS = 2000;
export const POST_PROCESSING_MAX_DELAY_MS = 5000;
export const MIN_USER_DELAY_SECONDS = 10;
export const MAX_USER_DELAY_SECONDS = 30;

// Defaults
export const DEFAULT_USERS_PER_SESSION = 5;
export const DEFAULT_POSTS_PER_USER = 20;
export const DEFAULT_MIN_INTERVAL_MINUTES = 30;

// User agents for Instagram requests
export const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Instagram 269.0.0.18.75",
  "Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36 Instagram 216.1.0.21.137",
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.87 Mobile Safari/537.36 Instagram 217.0.0.27.359",
] as const;
