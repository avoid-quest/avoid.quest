import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import { Badge } from "@avoid.quest/ui/components/badge";
import { RadioLogo } from "./radio-logo";

type RadioBrowserResultItemProps = {
  result: RadioBrowserStation;
  onSelect: (result: RadioBrowserStation) => void;
};

export function RadioBrowserResultItem({
  result,
  onSelect,
}: RadioBrowserResultItemProps) {
  const location = [result.state, result.country].filter(Boolean).join(", ");
  const details = location || result.tags.slice(0, 3).join(", ");

  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
      onClick={() => onSelect(result)}
      type="button"
    >
      <RadioLogo
        logoUrl={result.favicon || undefined}
        name={result.name}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm leading-snug">{result.name}</p>
          <Badge
            className="h-4 shrink-0 border-sky-500/30 bg-sky-500/10 px-1 text-[10px] text-sky-500"
            variant="outline"
          >
            RB
          </Badge>
        </div>
        {details && (
          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs leading-snug">
            {details}
          </p>
        )}
      </div>
    </button>
  );
}
