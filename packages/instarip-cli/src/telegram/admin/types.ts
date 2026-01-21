import type { Context, SessionFlavor } from "grammy";
import type { Logger } from "../types";

/**
 * Session data structure for admin bot
 */
export type SessionData = {
  usersPage: {
    cursor: string | null;
    page: number;
  };
  postsPage: {
    cursor: string | null;
    page: number;
    filter: "all" | "sent" | "unsent";
  };
  settingsSection: string | null;
  pendingInput: {
    type: string;
    section: string;
    key: string;
  } | null;
};

/**
 * Extended context for admin bot with additional properties
 */
export type AdminContext = Context &
  SessionFlavor<SessionData> & {
    adminChatId: string | null;
    logger: Logger;
  };
