/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { Button } from "@avoid.quest/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import {
  type ChangelogEntry,
  type ChangelogSeenAt,
  getChangelogSeenAt,
  isChangelogEntryUnseen,
  markChangelogSeen,
  subscribeChangelogSeen,
} from "@avoid.quest/ui/lib/changelog";
import { cn } from "@avoid.quest/ui/lib/utils";
import { CircleQuestionMarkIcon } from "lucide-react";
import { type ReactNode, useState, useSyncExternalStore } from "react";

type ChangelogProps = {
  /** Newest first. */
  entries: readonly ChangelogEntry[];
  /** localStorage key remembering when this browser last opened the list. */
  storageKey: string;
  /** Small print under the list, such as the app version. */
  footer?: ReactNode;
  className?: string;
};

// Unknown on the server, so nothing renders as new before hydration.
const getServerSeenAt = (): ChangelogSeenAt => undefined;

function formatEntryDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Icon button with a dot while there are changes this browser hasn't seen;
 * opening the list marks them seen.
 */
export function Changelog({
  entries,
  storageKey,
  footer,
  className,
}: ChangelogProps) {
  const seenAt = useSyncExternalStore(
    subscribeChangelogSeen,
    () => getChangelogSeenAt(storageKey),
    getServerSeenAt
  );
  // The mark from before this opening keeps new entries flagged while open.
  const [seenBeforeOpen, setSeenBeforeOpen] = useState<ChangelogSeenAt>();
  const hasUnseen = entries.some((entry) =>
    isChangelogEntryUnseen(entry, seenAt)
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      return;
    }
    setSeenBeforeOpen(seenAt);
    const [newest] = entries;
    if (newest && hasUnseen) {
      markChangelogSeen(storageKey, newest.date);
    }
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          aria-label={hasUnseen ? "What's new (unread)" : "What's new"}
          className={cn("relative size-7", className)}
          size="icon"
          title="What's new"
          variant="ghost"
        >
          <CircleQuestionMarkIcon className="size-3.5" />
          {hasUnseen ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="px-3 pt-2.5 pb-1 font-medium text-xs">What's new</p>
        {entries.length > 0 ? (
          <ul className="max-h-80 overflow-y-auto px-3 pb-2">
            {entries.map((entry) => {
              // A browser that never caught up would flag every entry.
              const isNew =
                seenBeforeOpen !== null &&
                isChangelogEntryUnseen(entry, seenBeforeOpen);
              return (
                <li className="flex items-baseline gap-3 py-1" key={entry.id}>
                  <span className="min-w-0 flex-1 text-sm">
                    {isNew ? <span className="sr-only">New: </span> : null}
                    {entry.text}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs tabular-nums">
                    {isNew ? (
                      <span className="size-1.5 rounded-full bg-primary" />
                    ) : null}
                    <time dateTime={entry.date}>
                      {formatEntryDate(entry.date)}
                    </time>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 pb-2.5 text-muted-foreground text-sm">
            Nothing new yet.
          </p>
        )}
        {footer ? (
          <div className="border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
