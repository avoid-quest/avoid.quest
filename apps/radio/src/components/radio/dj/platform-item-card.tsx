import type { PlatformMetadata } from "@avoid.quest/radio-shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { ExternalLinkIcon, Link2Icon, Music2Icon } from "lucide-react";
import {
  formatPlatformDuration,
  getPlatformItemTypeLabel,
} from "@/lib/external-url";

type PlatformItemCardProps = {
  metadata: PlatformMetadata;
  onChangeUrl?: () => void;
  className?: string;
};

export function PlatformItemCard({
  metadata,
  onChangeUrl,
  className,
}: PlatformItemCardProps) {
  const itemTypeLabel = getPlatformItemTypeLabel(metadata);
  const platformName =
    metadata.platform === "bandcamp" ? "Bandcamp" : "SoundCloud";

  const handleOpenUrl = () => {
    if (metadata.url) {
      window.open(metadata.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-4">
        {/* Platform & Type Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music2Icon className="size-4 text-muted-foreground" />
            <span className="font-medium text-muted-foreground text-xs">
              {platformName}
            </span>
          </div>
          <Badge className="text-xs" variant="secondary">
            {itemTypeLabel}
          </Badge>
        </div>

        {/* Item Info */}
        <div className="space-y-1">
          <h4 className="font-medium text-sm leading-tight">
            {metadata.name || "Unknown"}
          </h4>
          {metadata.artist?.trim() !== "" && (
            <p className="text-muted-foreground text-xs">{metadata.artist}</p>
          )}
        </div>

        {/* Collection Stats */}
        {metadata.trackCount?.valueOf() && metadata.trackCount > 1 && (
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span>{metadata.trackCount} tracks</span>
            {metadata.duration?.valueOf() && (
              <>
                <span>•</span>
                <span>{formatPlatformDuration(metadata.duration)}</span>
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {onChangeUrl?.valueOf() && (
            <Button
              className="flex-1"
              onClick={onChangeUrl}
              size="sm"
              variant="outline"
            >
              <Link2Icon className="mr-2 size-3" />
              Change URL
            </Button>
          )}
          {metadata.url?.trim() !== "" && (
            <Button onClick={handleOpenUrl} size="sm" variant="outline">
              <ExternalLinkIcon className="size-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
