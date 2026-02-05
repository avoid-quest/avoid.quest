import { formatPlatformDuration } from "@/lib/external-url/utils";

type PlatformTrackInfoProps = {
  artist?: string;
  albumName?: string;
  duration?: number;
};

export function PlatformTrackInfo({
  artist,
  albumName,
  duration,
}: PlatformTrackInfoProps) {
  const hasContent = artist || albumName || duration !== undefined;
  if (!hasContent) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="font-medium text-muted-foreground text-xs">
        Track Info
      </div>
      {artist?.trim() !== "" && (
        <div className="text-muted-foreground text-xs">{artist}</div>
      )}
      {albumName?.trim() !== "" && (
        <div className="text-muted-foreground text-xs">{albumName}</div>
      )}
      {duration !== undefined && (
        <div className="text-muted-foreground text-xs">
          Duration: {formatPlatformDuration(duration)}
        </div>
      )}
    </div>
  );
}
