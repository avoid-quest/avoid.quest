/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { cn } from "@avoid.quest/ui/lib/utils";
import { AudioLinesIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { EmptyHint } from "../empty-hint";
import { RadioItemActions } from "../radio-item-actions";
import { RadioListItemMetadata } from "../radio-list-item-metadata";
import { RadioLogo } from "../radio-logo";
import { RadioNowPlayingDetailsButton } from "../radio-now-playing";
import {
  StationRowSubtitle,
  StationRowText,
  stationFallbackSubtitle,
  stationRowButtonClassName,
  stationRowClassName,
} from "../station-row";

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
        stationRowClassName,
        isCurrent && "bg-muted/40",
        isSession && "border-l-2 border-l-[#00d084]/40"
      )}
      ref={elementRef}
    >
      <button
        aria-current={isCurrent ? "true" : undefined}
        className={stationRowButtonClassName}
        onClick={handleSelect}
        type="button"
      >
        <RadioLogo
          decorative
          logoUrl={radio.logoUrl}
          name={radio.name}
          size="md"
        />
        <StationRowText
          indicator={
            isCurrent && isPlaying ? (
              <AudioLinesIcon
                aria-label="Playing"
                className="size-3.5 shrink-0"
                role="img"
              />
            ) : null
          }
          isCurrent={isCurrent}
          title={radio.name}
        >
          <RadioListItemMetadata
            fallback={
              <StationRowSubtitle>
                {stationFallbackSubtitle(radio)}
              </StationRowSubtitle>
            }
            metadata={metadata}
            radio={radio}
          />
        </StationRowText>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5",
          !isSession &&
            "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 [@media(pointer:coarse)]:opacity-60"
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
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col border-border/50 lg:w-80 lg:flex-none lg:border-r xl:w-96">
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
          <EmptyHint className="py-10">Search to add a station</EmptyHint>
        )}
      </ScrollArea>
    </div>
  );
}
