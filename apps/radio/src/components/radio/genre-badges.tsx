import { Badge } from "@avoid.quest/ui/components/badge";
import { cn } from "@avoid.quest/ui/lib/utils";
import { isPlaceholderMetadataValue } from "@/lib/metadata/title-parser";

const GENRE_SEPARATOR_PATTERN = /[,;|]/;
// "Rock/Pop" is two genres; a spaced "R&B / Soul" stays one label.
const GENRE_SLASH_PATTERN = /(?<=\S)\/(?=\S)/;

/** Distinct genres, keeping the first spelling and dropping placeholders. */
export function splitGenres(genre?: string | null): string[] {
  const genres = new Map<string, string>();
  const parts = (genre?.split(GENRE_SEPARATOR_PATTERN) ?? [])
    // Drop "n/a" before "/" splits it into "n" and "a".
    .filter((part) => !isPlaceholderMetadataValue(part))
    .flatMap((part) => part.split(GENRE_SLASH_PATTERN));
  for (const part of parts) {
    const value = part.trim();
    const key = value.toLowerCase();
    if (!(isPlaceholderMetadataValue(value) || genres.has(key))) {
      genres.set(key, value);
    }
  }
  return [...genres.values()];
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
