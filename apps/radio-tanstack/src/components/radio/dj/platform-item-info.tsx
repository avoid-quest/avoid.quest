"use client";

type PlatformItemInfoProps = {
  trackCount?: number;
  duration?: number;
};

export function PlatformItemInfo({
  trackCount,
  duration,
}: PlatformItemInfoProps) {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  if (!(trackCount || duration)) {
    return null;
  }

  return (
    <div className="space-y-1">
      {duration !== undefined && (
        <div className="text-muted-foreground text-xs">
          Total Duration: {formatDuration(duration)}
        </div>
      )}
    </div>
  );
}
