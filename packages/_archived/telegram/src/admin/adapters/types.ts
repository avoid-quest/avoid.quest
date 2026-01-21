import type { Logger } from "../../logger/types";

/**
 * Authentication provider interface
 * Implement this to connect admin authentication to your backend
 */
export type AuthProvider = {
  /**
   * Check if a chat ID is authorized for admin access
   */
  isAuthorized(chatId: string): Promise<boolean>;

  /**
   * Get the authorized admin chat ID
   * Returns null if not configured
   */
  getAuthorizedChatId(): Promise<string | null>;
};

/**
 * Settings provider interface
 * Implement this to connect settings storage to your backend
 */
export type SettingsProvider<T = Record<string, unknown>> = {
  /**
   * Get all settings
   */
  getSettings(): Promise<T | null>;

  /**
   * Update a single setting
   */
  updateSetting(section: string, key: string, value: unknown): Promise<void>;
};

/**
 * Generic data provider for paginated queries
 */
export type DataProvider<T> = {
  /**
   * Query items with pagination
   */
  query(options: {
    cursor: string | null;
    numItems: number;
    filter?: Record<string, unknown>;
  }): Promise<{
    items: T[];
    continueCursor: string | null;
    isDone: boolean;
  }>;
};

/**
 * Logger interface for admin operations
 * Uses the standard Logger interface for consistency across the package
 */
export type AdminLogger = Logger;
