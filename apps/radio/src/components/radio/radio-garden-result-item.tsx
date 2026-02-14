import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import { BookmarkIcon, MapPinIcon } from "lucide-react";

type RadioGardenResultItemProps = {
  result: RadioGardenSearchResult;
  onSelect: (result: RadioGardenSearchResult) => void;
  onSave?: (result: RadioGardenSearchResult) => void;
  isLoading?: boolean;
};

export function RadioGardenResultItem({
  result,
  onSelect,
  onSave,
  isLoading,
}: RadioGardenResultItemProps) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/40">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        disabled={isLoading}
        onClick={() => onSelect(result)}
        type="button"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-[#00d084]/10">
          <MapPinIcon className="size-4 text-[#00d084]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm leading-snug">{result.title}</p>
            <Badge
              className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
              variant="outline"
            >
              RG
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs leading-snug">
            {result.placeTitle}, {result.countryTitle}
          </p>
        </div>
      </button>
      {onSave && (
        <Button
          aria-label="Save to collection"
          className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onSave(result);
          }}
          size="sm"
          variant="ghost"
        >
          <BookmarkIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
