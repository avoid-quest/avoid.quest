/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { AudioLinesIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { RadioItemActions } from "../radio-item-actions";
import { RadioListItemMetadata } from "../radio-list-item-metadata";
import { RadioLogo } from "../radio-logo";
import { RadioNowPlayingDetailsButton } from "../radio-now-playing";

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
  isPlaying,
  onSelect,
  onTogglePlayPause,
  onEdit,
  onDelete,
  onSave,
  onToggle,
}: {
  radio: Radio;
  isCurrent: boolean;
  isPlaying: boolean;
  onSelect: (radio: Radio) => void;
  onTogglePlayPause: () => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
}) {
  const isSession = isSessionRadio(radio);
  const { elementRef, hasEnteredViewport } =
    useHasEnteredViewport<HTMLDivElement>();
  const { metadata } = useRadioMetadata({
    enabled: hasEnteredViewport,
    poll: false,
    radio,
  });
  const handleSelect = () => {
    if (isCurrent) {
      onTogglePlayPause();
    } else {
      onSelect(radio);
    }
  };

  return (
    <div
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
        "hover:bg-muted/40",
        isSession && "border-l-2 border-l-[#00d084]/40"
      )}
      ref={elementRef}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {isCurrent && isPlaying ? (
              <span title="Playing">
                <AudioLinesIcon aria-hidden className="size-3.5" />
                <span className="sr-only">Playing</span>
              </span>
            ) : null}
          </div>
          <RadioListItemMetadata
            fallback={<StationLocationLabel radio={radio} />}
            metadata={metadata}
            radio={radio}
          />
        </div>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5",
          !isSession &&
            "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-60"
        )}
      >
        <RadioNowPlayingDetailsButton metadata={metadata} radio={radio} />
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
  isPlaying,
  onSelect,
  onTogglePlayPause,
  onEdit,
  onDelete,
  onSave,
  onToggle,
  searchBar,
}: {
  radios: Radio[] | undefined;
  sessionRadios: Radio[];
  currentRadioId: string | number | undefined;
  isPlaying: boolean;
  onSelect: (radio: Radio) => void;
  onTogglePlayPause: () => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
  searchBar: React.ReactNode;
}) {
  const allRadios = [
    ...sessionRadios,
    ...(radios ?? []).filter(
      (r) => !sessionRadios.some((sr) => sr.id === r.id)
    ),
  ];

  return (
    <div className="flex min-h-0 w-full flex-col border-border/50 lg:w-80 lg:shrink-0 lg:border-r xl:w-96">
      <div className="px-3 py-2">{searchBar}</div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {allRadios.length > 0 ? (
          <div className="flex w-0 min-w-full flex-col gap-1 px-1.5 pb-1.5">
            {allRadios.map((radio) => (
              <StationRow
                isCurrent={currentRadioId === radio.id}
                isPlaying={isPlaying}
                key={radio.id}
                onDelete={onDelete}
                onEdit={onEdit}
                onSave={onSave}
                onSelect={onSelect}
                onToggle={onToggle}
                onTogglePlayPause={onTogglePlayPause}
                radio={radio}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <AudioLinesIcon className="mb-3 size-8 text-muted-foreground/20" />
            <p className="text-muted-foreground/60 text-xs">
              Search to add a station
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
