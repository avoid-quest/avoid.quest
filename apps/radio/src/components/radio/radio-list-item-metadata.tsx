import { cn } from "@avoid.quest/ui/lib/utils";
import type { ReactNode } from "react";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying } from "@/lib/metadata/types";
import { GenreBadges, splitGenres } from "./genre-badges";
import { sameText } from "./radio-now-playing";

export function RadioListItemMetadata({
  radio,
  metadata,
  fallback,
  className,
}: {
  radio: Radio;
  metadata?: RadioNowPlaying | null;
  fallback?: ReactNode;
  className?: string;
}) {
  const title = metadata?.title || metadata?.artist;
  if (!title) {
    return fallback ?? null;
  }

  const artist =
    metadata?.title && !sameText(metadata.artist, metadata.title)
      ? metadata.artist
      : null;
  const [genre] = splitGenres(metadata?.genre);
  const identity = [title, artist].filter(Boolean).join(" · ");

  return (
    <div
      className={cn("mt-0.5 flex min-w-0 items-center gap-1.5", className)}
      title={`Now playing on ${radio.name}: ${identity}${genre ? `, ${genre}` : ""}`}
    >
      <p
        className="min-w-0 truncate text-muted-foreground text-xs leading-snug"
        dir="auto"
      >
        {identity}
      </p>
      <GenreBadges
        className="max-w-32 shrink-0 flex-nowrap"
        genre={metadata?.genre}
        limit={1}
      />
    </div>
  );
}
