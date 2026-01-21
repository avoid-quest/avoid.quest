import type { MenuRange } from "@grammyjs/menu";
import type { Context } from "grammy";

const DEFAULT_ITEMS_PER_PAGE = 5;

/**
 * Build pagination keyboard buttons
 */
export function buildPaginationButtons<C extends Context>(opts: {
  range: MenuRange<C>;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev?: (ctx: C) => Promise<void>;
  onNext?: (ctx: C) => Promise<void>;
}): void {
  const { range, hasPrev, hasNext, onPrev, onNext } = opts;
  if (hasPrev || hasNext) {
    if (hasPrev && onPrev) {
      range.text("Prev", onPrev);
    }
    if (hasNext && onNext) {
      range.text("Next", onNext);
    }
    range.row();
  }
}

/**
 * Format paginated list text
 */
export function formatPaginatedList<T extends { _id: string }>(opts: {
  items: T[];
  currentPage: number;
  isDone: boolean;
  itemFormatter: (item: T, index: number) => string;
  title: string;
  itemsPerPage?: number;
}): string {
  const {
    items,
    currentPage,
    isDone,
    itemFormatter,
    title,
    itemsPerPage = DEFAULT_ITEMS_PER_PAGE,
  } = opts;
  let text = `<b>${title}</b>\n\n`;

  if (items.length === 0) {
    text += "No items found.";
    return text;
  }

  for (const [index, item] of items.entries()) {
    const globalIndex = (currentPage - 1) * itemsPerPage + index + 1;
    text += `${globalIndex}. ${itemFormatter(item, index)}\n`;
  }

  text += `\n<i>Page ${currentPage}${isDone ? "" : " (more available)"}</i>`;

  return text;
}

/**
 * Get pagination options for query
 */
export function getPaginationOpts(
  cursor: string | null,
  numItems: number = DEFAULT_ITEMS_PER_PAGE
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
    // Limitation: cursor-based pagination only goes forward
    // Reset to page 1 for prev
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

export { DEFAULT_ITEMS_PER_PAGE };
