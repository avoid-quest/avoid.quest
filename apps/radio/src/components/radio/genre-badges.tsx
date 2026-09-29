import { Badge } from "@avoid.quest/ui/components/badge";
import { cn } from "@avoid.quest/ui/lib/utils";

export function splitGenres(genre?: string | null): string[] {
  return [
    ...new Set(
      genre
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

const badgeClassName =
  "h-4 max-w-full border-foreground/15 bg-transparent px-1.5 py-0 font-normal text-[9px] text-muted-foreground leading-none";

/**
 * The one way genres are shown anywhere in the app: small outline pills.
 * `limit` shows the first N and folds the rest into a "+N" pill.
 */
export function GenreBadges({
  genre,
  limit,
  className,
}: {
  genre?: string | null;
  limit?: number;
  className?: string;
}) {
  const genres = splitGenres(genre);
  if (genres.length === 0) {
    return null;
  }
  const shown = limit ? genres.slice(0, limit) : genres;
  const rest = genres.length - shown.length;

  return (
    <ul
      aria-label="Genres"
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
      title={genres.join(", ")}
    >
      {shown.map((value) => (
        <li className="flex min-w-0 max-w-full" key={value}>
          <Badge className={badgeClassName} variant="outline">
            <span className="truncate">{value}</span>
          </Badge>
        </li>
      ))}
      {rest > 0 ? (
        <li className="flex">
          <Badge className={badgeClassName} variant="outline">
            <span aria-hidden="true">+{rest}</span>
            <span className="sr-only">{rest} more genres in Details</span>
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}
