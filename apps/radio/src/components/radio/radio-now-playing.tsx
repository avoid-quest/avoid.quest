import { cn } from "@avoid.quest/ui/lib/utils";
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
    <p className={cn("text-foreground/80 text-xs leading-snug", className)}>
      {nowPlaying}
    </p>
  );
}
