import { cn } from "@avoid.quest/ui/lib/utils";
import type { Radio } from "@/lib/audio";

/**
 * The one station row: Single's list, the search dropdown and the DJ deck
 * picker all compose these pieces so a station looks the same everywhere.
 */
export const stationRowClassName =
  "group flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40";

export const stationRowButtonClassName =
  "flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A row that is one button end to end, with no trailing actions. */
export const stationRowButtonOnlyClassName = cn(
  stationRowClassName,
  "gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
);

/** "Place, Country", without repeating a place that is its own country. */
export function formatLocation(
  place: string | undefined,
  country: string | undefined
): string {
  const distinctPlace =
    place?.toLocaleLowerCase() === country?.toLocaleLowerCase()
      ? undefined
      : place;
  return [distinctPlace, country].filter(Boolean).join(", ");
}

/** What a row says under the name when nothing is playing: where, else what. */
export function stationFallbackSubtitle(radio: Radio): string | undefined {
  return (
    formatLocation(radio.placeTitle, radio.countryTitle) ||
    radio.description?.trim() ||
    undefined
  );
}

export function StationRowText({
  title,
  isCurrent = false,
  indicator,
  children,
}: {
  title: string;
  isCurrent?: boolean;
  indicator?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <p
          className={cn(
            "truncate text-sm leading-snug",
            isCurrent && "font-semibold"
          )}
          dir="auto"
        >
          {title}
        </p>
        {indicator}
      </div>
      {children}
    </div>
  );
}

export function StationRowSubtitle({
  children,
}: {
  children?: React.ReactNode;
}) {
  if (!children) {
    return null;
  }
  return (
    <p
      className="mt-0.5 truncate text-muted-foreground text-xs leading-snug"
      dir="auto"
    >
      {children}
    </p>
  );
}
