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
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const hasContent = artist || albumName || duration !== undefined;
  if (!hasContent) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="font-medium text-muted-foreground text-xs">
        Track Info
      </div>
      {artist && <div className="text-muted-foreground text-xs">{artist}</div>}
      {albumName && (
        <div className="text-muted-foreground text-xs">{albumName}</div>
      )}
      {duration !== undefined && (
        <div className="text-muted-foreground text-xs">
          Duration: {formatDuration(duration)}
        </div>
      )}
    </div>
  );
}
