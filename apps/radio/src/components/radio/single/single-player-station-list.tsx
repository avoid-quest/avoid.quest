/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { AudioLinesIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";

function StationLocationLabel({ radio }: { radio: Radio }) {
  if (radio.placeTitle) {
    return (
      <p className="mt-0.5 truncate text-muted-foreground/60 text-xs leading-snug">
        {radio.placeTitle}, {radio.countryTitle}
      </p>
    );
  }
  if (radio.description) {
    return (
      <p className="mt-0.5 line-clamp-2 text-muted-foreground/60 text-xs leading-snug">
        {radio.description}
      </p>
    );
  }
  return null;
}

function StationRow({
  radio,
  isCurrent,
  onSelect,
  onEdit,
  onDelete,
  onSave,
  onToggle,
}: {
  radio: Radio;
  isCurrent: boolean;
  onSelect: (radio: Radio) => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
}) {
  const isSession = isSessionRadio(radio);
  const handleSelect = () => onSelect(radio);

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
        "hover:bg-muted/40",
        isSession && "border-l-2 border-l-[#00d084]/40"
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={handleSelect}
        type="button"
      >
        <RadioLogo logoUrl={radio.logoUrl} name={radio.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={cn(
                "truncate text-sm leading-snug",
                isCurrent && "font-semibold"
              )}
            >
              {radio.name}
            </p>
            {isCurrent ? (
              <span title="Selected">
                <AudioLinesIcon aria-hidden className="size-3.5" />
                <span className="sr-only">Selected</span>
              </span>
            ) : null}
          </div>
          <StationLocationLabel radio={radio} />
        </div>
      </button>
      <div
        className={cn(
          "shrink-0",
          !isSession && "opacity-0 group-hover:opacity-100"
        )}
      >
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>
    </div>
  );
}

export function StationList({
  radios,
  sessionRadios,
  currentRadioId,
  onSelect,
  onEdit,
  onDelete,
  onSave,
  onToggle,
  searchBar,
}: {
  radios: Radio[] | undefined;
  sessionRadios: Radio[];
  currentRadioId: string | number | undefined;
  onSelect: (radio: Radio) => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
  searchBar: React.ReactNode;
}) {
  const allRadios = [
    ...(radios ?? []),
    ...sessionRadios.filter((sr) => !radios?.some((r) => r.id === sr.id)),
  ];

  return (
    <div className="flex min-h-0 w-full flex-col border-border/50 lg:w-80 lg:shrink-0 lg:border-r xl:w-96">
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
            Stations
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {allRadios.length}
          </span>
        </div>
        {searchBar}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {allRadios.length > 0 ? (
          <div className="flex flex-col gap-1 px-1.5 pb-1.5">
            {allRadios.map((radio) => (
              <StationRow
                isCurrent={currentRadioId === radio.id}
                key={radio.id}
                onDelete={onDelete}
                onEdit={onEdit}
                onSave={onSave}
                onSelect={onSelect}
                onToggle={onToggle}
                radio={radio}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <AudioLinesIcon className="mb-3 size-8 text-muted-foreground/20" />
            <p className="font-mono text-muted-foreground/40 text-xs uppercase tracking-wider">
              No stations enabled
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
