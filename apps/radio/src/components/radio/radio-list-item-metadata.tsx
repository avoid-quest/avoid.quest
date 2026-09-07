import { Badge } from "@avoid.quest/ui/components/badge";
import { cn } from "@avoid.quest/ui/lib/utils";
import type { ReactNode } from "react";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying } from "@/lib/metadata/types";

function getFirstGenre(genre?: string | null): string | null {
  return (
    genre
      ?.split(",")
      .map((value) => value.trim())
      .find(Boolean) ?? null
  );
}

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
    metadata?.title && metadata.artist !== metadata.title
      ? metadata.artist
      : null;
  const genre = getFirstGenre(metadata?.genre);
  const identity = [title, artist].filter(Boolean).join(" · ");

  return (
    <div
      className={cn("mt-0.5 flex min-w-0 items-center gap-1.5", className)}
      title={`Now playing on ${radio.name}: ${identity}${genre ? `, ${genre}` : ""}`}
    >
      <p className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-snug">
        {identity}
      </p>
      {genre ? (
        <Badge
          className="h-4 max-w-24 shrink-0 truncate border-foreground/10 bg-transparent px-1.5 py-0 font-normal text-[9px] text-muted-foreground leading-none"
          title={metadata?.genre ?? genre}
          variant="outline"
        >
          {genre}
        </Badge>
      ) : null}
    </div>
  );
}
