import { cn } from "@avoid.quest/ui/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import { formatNowPlaying } from "@/lib/metadata/display";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";

type RadioNowPlayingProps = {
  metadata: RadioNowPlayingMetadata | null | undefined;
  className?: string;
  showDetails?: boolean;
};

export function RadioNowPlaying({
  metadata,
  className,
  showDetails = false,
}: RadioNowPlayingProps) {
  const nowPlaying = formatNowPlaying(metadata);
  if (!nowPlaying) {
    return null;
  }

  const context = [metadata?.album, metadata?.genre]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");

  return (
    <div
      className={cn(
        "min-w-0 text-foreground/80 text-xs leading-snug",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate">{nowPlaying}</span>
        {metadata?.itemUrl ? (
          <a
            aria-label="More info about this show or track"
            className="ml-1 inline-flex shrink-0 items-center text-primary/80 transition-colors hover:text-primary"
            href={metadata.itemUrl}
            rel="noopener noreferrer"
            target="_blank"
            title="More info"
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
      </div>
      {showDetails && context ? (
        <p className="mt-1 truncate text-muted-foreground/80">{context}</p>
      ) : null}
      {showDetails && metadata?.stationDescription ? (
        <p className="mt-1 line-clamp-2 text-muted-foreground leading-relaxed">
          {metadata.stationDescription}
        </p>
      ) : null}
    </div>
  );
}
