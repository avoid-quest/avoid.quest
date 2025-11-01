/**
 * CLI validation functions
 */

const MIN_POSTS_PER_PROFILE = 1;
const MAX_POSTS_PER_PROFILE = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;
const MIN_MAX_USERS = 1;
const MAX_MAX_USERS = 50;

const INSTAGRAM_URL_PATTERN =
  /^https?:\/\/(www\.)?instagram\.com\/p\/[a-zA-Z0-9_-]+\/?$/;

/**
 * Validate posts per profile range
 */
export function validatePostsPerProfile(value: number): {
  isValid: boolean;
  error?: string;
} {
  if (Number.isNaN(value)) {
    return {
      isValid: false,
      error: "❌ --posts-per-profile must be a valid number",
    };
  }
  if (value < MIN_POSTS_PER_PROFILE || value > MAX_POSTS_PER_PROFILE) {
    return {
      isValid: false,
      error: `❌ --posts-per-profile must be between ${MIN_POSTS_PER_PROFILE} and ${MAX_POSTS_PER_PROFILE}`,
    };
  }
  return { isValid: true };
}

/**
 * Validate limit range
 */
export function validateLimit(value: number): {
  isValid: boolean;
  error?: string;
} {
  if (Number.isNaN(value)) {
    return {
      isValid: false,
      error: "❌ --limit must be a valid number",
    };
  }
  if (value < MIN_LIMIT || value > MAX_LIMIT) {
    return {
      isValid: false,
      error: `❌ --limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
    };
  }
  return { isValid: true };
}

/**
 * Validate max users range
 */
export function validateMaxUsers(value: number): {
  isValid: boolean;
  error?: string;
} {
  if (Number.isNaN(value)) {
    return {
      isValid: false,
      error: "❌ --max-users must be a valid number",
    };
  }
  if (value < MIN_MAX_USERS || value > MAX_MAX_USERS) {
    return {
      isValid: false,
      error: `❌ --max-users must be between ${MIN_MAX_USERS} and ${MAX_MAX_USERS}`,
    };
  }
  return { isValid: true };
}

/**
 * Validate Instagram post URL format
 */
export function validatePostUrl(url: string): {
  isValid: boolean;
  error?: string;
} {
  if (!url || url.trim().length === 0) {
    return {
      isValid: false,
      error: "❌ Post URL cannot be empty",
    };
  }

  if (!INSTAGRAM_URL_PATTERN.test(url)) {
    return {
      isValid: false,
      error: "❌ Invalid Instagram post URL format",
    };
  }

  return { isValid: true };
}
