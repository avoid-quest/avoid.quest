import type { Context, SessionFlavor } from "grammy";
import type { AdminLogger } from "../adapters/types";

/**
 * Base session data structure for admin bot
 * Consumers can extend this with their own session data
 */
export type BaseSessionData = {
  /** Cursor-based pagination state */
  pagination: Record<
    string,
    {
      cursor: string | null;
      page: number;
    }
  >;
};

/**
 * Admin context properties added by middleware
 */
export type AdminContextFlavor = {
  adminChatId: string | null;
  logger: AdminLogger;
};

/**
 * Full admin context type
 * Consumers can extend this with their own context types
 */
export type AdminContext<S extends BaseSessionData = BaseSessionData> =
  Context & SessionFlavor<S> & AdminContextFlavor;
