import { cn } from "@avoid.quest/ui/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import { formatNowPlaying } from "@/lib/metadata/display";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";

type RadioNowPlayingProps = {
  metadata: RadioNowPlayingMetadata | null | undefined;
  className?: string;
};

export function RadioNowPlaying({ metadata, className }: RadioNowPlayingProps) {
  const nowPlaying = formatNowPlaying(metadata);
  if (!nowPlaying) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-foreground/80 text-xs leading-snug",
        className
      )}
    >
      <span className="truncate">{nowPlaying}</span>
      {metadata?.itemUrl && (
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
      )}
    </span>
  );
}
