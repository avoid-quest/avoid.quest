import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { InfoIcon, Link2Icon, MicIcon, MicOffIcon, XIcon } from "lucide-react";
import { useMemo } from "react";
import { EffectChain } from "@/components/audio/effect-chain";
import type { ChannelSelection, EffectConfig, EffectType } from "@/lib/audio";
import { DeckPeakMeter } from "./peak-meter";

type InputDeckLayoutProps = {
  deviceLabel: string;
  channelSelection: ChannelSelection;
  channelCount: number;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  pan: number;
  channelFilter: number;
  effectsDryWet: number;
  peakLevel?: { left: number; right: number };
  effects?: EffectConfig[];
  deckSide: "left" | "right";
  onToggleMute: () => void;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
  onChannelSelectionChange: (selection: ChannelSelection) => void;
  onChangeDevice: () => void;
  onClear: () => void;
  onAddEffect?: (type: EffectType) => void;
  onUpdateEffect?: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect?: (effectId: string) => void;
  onReorderEffects?: (effectIds: string[]) => void;
  className?: string;
};

// ============================================================================
// Shared sub-components
// ============================================================================

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.05) {
    return "C";
  }
  const percent = Math.abs(Math.round(pan * 100));
  return pan < 0 ? `L${percent}` : `R${percent}`;
}

function formatChannelFilter(value: number): string {
  if (Math.abs(value) < 0.05) {
    return "OFF";
  }
  return value < 0
    ? `LP ${Math.round(Math.abs(value) * 100)}%`
    : `HP ${Math.round(value * 100)}%`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type InputChannelSliderProps = {
  label: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
};

function InputChannelSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  formatValue,
}: InputChannelSliderProps) {
  return (
    <div className="flex h-7 items-center gap-2">
      <span className="w-8 shrink-0 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <Slider
        className="min-w-0 flex-1"
        defaultValue={defaultValue !== undefined ? [defaultValue] : undefined}
        max={max}
        min={min}
        onValueChange={([v]) => onChange(v)}
        step={step}
        value={[value]}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

type ChannelOption = {
  key: string;
  label: string;
  selection: ChannelSelection;
};

function serializeSelection(s: ChannelSelection): string {
  return `${s.left}:${s.right}`;
}

function deserializeSelection(key: string): ChannelSelection {
  const [left, right] = key.split(":").map(Number);
  return { left: left ?? 0, right: right ?? 1 };
}

function buildChannelOptions(channelCount: number): ChannelOption[] {
  const options: ChannelOption[] = [];

  for (let i = 0; i + 1 < channelCount; i += 2) {
    const selection = { left: i, right: i + 1 };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${i + 1}+${i + 2} (Stereo)`,
      selection,
    });
  }

  for (let i = 0; i < channelCount; i++) {
    const selection = { left: i, right: i };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${i + 1} (Mono)`,
      selection,
    });
  }

  return options;
}

function DeviceInfoHeader({
  deviceLabel,
  isPlaying,
}: {
  deviceLabel: string;
  isPlaying: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
      <MicIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-semibold text-sm">
        {deviceLabel}
      </span>
      <Badge className="shrink-0" variant={isPlaying ? "default" : "secondary"}>
        {isPlaying ? "LIVE" : "MUTED"}
      </Badge>
    </div>
  );
}

function ChannelSelectionRow({
  channelCount,
  channelOptions,
  selectedKey,
  onChannelSelectionChange,
}: {
  channelCount: number;
  channelOptions: ChannelOption[];
  selectedKey: string;
  onChannelSelectionChange: (selection: ChannelSelection) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-16 shrink-0 items-center gap-1 font-medium text-muted-foreground text-xs">
        Channel
        {channelCount <= 2 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="size-3 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-56" side="top">
              Browsers limit audio input to 2 channels per device. To route
              other channels, create an Aggregate Device in macOS Audio MIDI
              Setup or use virtual audio routing software.
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <Select
        onValueChange={(v) => onChannelSelectionChange(deserializeSelection(v))}
        value={selectedKey}
      >
        <SelectTrigger className="h-7 flex-1 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {channelOptions.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MuteToggleButton({
  isPlaying,
  isLoading,
  onToggleMute,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  onToggleMute: () => void;
}) {
  return (
    <Button
      className="w-full"
      disabled={isLoading}
      onClick={onToggleMute}
      size="sm"
      variant={isPlaying ? "destructive" : "default"}
    >
      {isPlaying ? (
        <>
          <MicOffIcon className="mr-2 size-4" />
          Mute
        </>
      ) : (
        <>
          <MicIcon className="mr-2 size-4" />
          Go Live
        </>
      )}
    </Button>
  );
}

function ChannelStrip({
  volume,
  pan,
  channelFilter,
  effectsDryWet,
  onVolumeChange,
  onPanChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
}: {
  volume: number;
  pan: number;
  channelFilter: number;
  effectsDryWet: number;
  onVolumeChange: (value: number[]) => void;
  onPanChange: (value: number) => void;
  onChannelFilterChange: (value: number) => void;
  onEffectsDryWetChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <InputChannelSlider
        defaultValue={1}
        formatValue={formatPercent}
        label="VOL"
        max={1.585}
        min={0}
        onChange={(v) => onVolumeChange([v])}
        step={0.01}
        value={volume}
      />
      <InputChannelSlider
        defaultValue={0}
        formatValue={formatPan}
        label="PAN"
        max={1}
        min={-1}
        onChange={onPanChange}
        step={0.01}
        value={pan}
      />
      <InputChannelSlider
        defaultValue={0}
        formatValue={formatChannelFilter}
        label="FILT"
        max={1}
        min={-1}
        onChange={onChannelFilterChange}
        step={0.01}
        value={channelFilter}
      />
      <InputChannelSlider
        defaultValue={0}
        formatValue={formatPercent}
        label="FX"
        max={1}
        min={0}
        onChange={onEffectsDryWetChange}
        step={0.01}
        value={effectsDryWet}
      />
    </div>
  );
}

function DeckFooter({
  onChangeDevice,
  onClear,
}: {
  onChangeDevice: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex gap-1 border-t pt-1.5">
      <Button
        className="h-7 flex-1 text-xs"
        onClick={onChangeDevice}
        size="sm"
        variant="ghost"
      >
        <Link2Icon className="mr-1.5 size-3" />
        Change Device
      </Button>
      <Button
        className="h-7 flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
        onClick={onClear}
        size="sm"
        variant="ghost"
      >
        <XIcon className="mr-1.5 size-3" />
        Eject
      </Button>
    </div>
  );
}

// ============================================================================
// Main layout
// ============================================================================

export function InputDeckLayout({
  deviceLabel,
  channelSelection,
  channelCount,
  isPlaying,
  isLoading,
  volume,
  pan,
  channelFilter,
  effectsDryWet,
  peakLevel,
  effects = [],
  deckSide,
  onToggleMute,
  onVolumeChange,
  onPanChange,
  onChannelFilterChange,
  onEffectsDryWetChange,
  onChannelSelectionChange,
  onChangeDevice,
  onClear,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  className,
}: InputDeckLayoutProps) {
  const isMobile = useIsMobile();
  const channelOptions = useMemo(
    () => buildChannelOptions(channelCount),
    [channelCount]
  );
  const selectedKey = serializeSelection(channelSelection);

  const sharedControls = (
    <>
      <DeviceInfoHeader deviceLabel={deviceLabel} isPlaying={isPlaying} />
      <ChannelSelectionRow
        channelCount={channelCount}
        channelOptions={channelOptions}
        onChannelSelectionChange={onChannelSelectionChange}
        selectedKey={selectedKey}
      />
      <MuteToggleButton
        isLoading={isLoading}
        isPlaying={isPlaying}
        onToggleMute={onToggleMute}
      />
      <ChannelStrip
        channelFilter={channelFilter}
        effectsDryWet={effectsDryWet}
        onChannelFilterChange={onChannelFilterChange}
        onEffectsDryWetChange={onEffectsDryWetChange}
        onPanChange={onPanChange}
        onVolumeChange={onVolumeChange}
        pan={pan}
        volume={volume}
      />
    </>
  );

  const effectChain = onAddEffect &&
    onUpdateEffect &&
    onRemoveEffect &&
    onReorderEffects && (
      <EffectChain
        effects={effects}
        onAddEffect={onAddEffect}
        onRemoveEffect={onRemoveEffect}
        onReorderEffects={onReorderEffects}
        onUpdateEffect={onUpdateEffect}
      />
    );

  if (isMobile) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="source">Source</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
          </TabsList>

          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
            value="source"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 pr-3">{sharedControls}</div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
            value="effects"
          >
            {effectChain && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {effectChain}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DeckFooter onChangeDevice={onChangeDevice} onClear={onClear} />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      {/* VU Meter on inner edge for Deck B (left side = inner) */}
      {deckSide === "right" && <DeckPeakMeter peakLevel={peakLevel} />}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 pr-3">
            {sharedControls}
            {effectChain}
          </div>
        </ScrollArea>

        <DeckFooter onChangeDevice={onChangeDevice} onClear={onClear} />
      </div>

      {/* VU Meter on inner edge for Deck A (right side = inner) */}
      {deckSide === "left" && <DeckPeakMeter peakLevel={peakLevel} />}
    </div>
  );
}
