import { formatPlatformDuration } from "@/lib/external-url/utils";

type PlatformItemInfoProps = {
  trackCount?: number;
  duration?: number;
};

export function PlatformItemInfo({
  trackCount,
  duration,
}: PlatformItemInfoProps) {
  if (!(trackCount || duration)) {
    return null;
  }

  return (
    <div className="space-y-1">
      {duration !== undefined && (
        <div className="text-muted-foreground text-xs">
          Total Duration: {formatPlatformDuration(duration)}
        </div>
      )}
    </div>
  );
}
