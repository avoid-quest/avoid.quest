import type { MenuRange } from "@grammyjs/menu";
import type { AdminContext } from "../types";

const ITEMS_PER_PAGE = 5;

/**
 * Build pagination keyboard buttons
 * Creates buttons with handlers that will be called when clicked
 */
export function buildPaginationButtons(opts: {
  range: MenuRange<AdminContext>;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev?: (ctx: AdminContext) => Promise<void>;
  onNext?: (ctx: AdminContext) => Promise<void>;
}): void {
  const { range, hasPrev, hasNext, onPrev, onNext } = opts;
  if (hasPrev || hasNext) {
    if (hasPrev && onPrev) {
      range.text("◀️ Prev", onPrev);
    }
    if (hasNext && onNext) {
      range.text("Next ▶️", onNext);
    }
    range.row();
  }
}

/**
 * Format paginated list text
 */
export function formatPaginatedList(opts: {
  items: Array<{ _id: string; [key: string]: unknown }>;
  currentPage: number;
  isDone: boolean;
  itemFormatter: (item: unknown) => string;
  title: string;
}): string {
  const { items, currentPage, isDone, itemFormatter, title } = opts;
  let text = `<b>${title}</b>\n\n`;

  if (items.length === 0) {
    text += "No items found.";
    return text;
  }

  items.forEach((item, index) => {
    const globalIndex = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
    text += `${globalIndex}. ${itemFormatter(item)}\n`;
  });

  text += `\n<i>Page ${currentPage}${isDone ? "" : " (more available)"}</i>`;

  return text;
}

/**
 * Get pagination options for Convex query
 */
export function getPaginationOpts(
  cursor: string | null,
  numItems: number = ITEMS_PER_PAGE
): { numItems: number; cursor: string | null } {
  return {
    numItems,
    cursor,
  };
}

/**
 * Handle pagination navigation
 */
export function handlePaginationNavigation(opts: {
  action: string;
  currentCursor: string | null;
  currentPage: number;
  continueCursor: string | null;
  isDone: boolean;
}): { cursor: string | null; page: number } {
  const { action, currentCursor, currentPage, continueCursor, isDone } = opts;
  if (action === "next" && continueCursor && !isDone) {
    return {
      cursor: continueCursor,
      page: currentPage + 1,
    };
  }

  if (action === "prev" && currentPage > 1) {
    // For previous, we need to reset to beginning and navigate forward
    // This is a limitation - Convex pagination only goes forward
    // We'll reset to page 1 for now
    return {
      cursor: null,
      page: 1,
    };
  }

  return {
    cursor: currentCursor,
    page: currentPage,
  };
}

export { ITEMS_PER_PAGE };
