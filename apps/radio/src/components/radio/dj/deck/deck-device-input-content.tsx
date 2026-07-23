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
import { InfoIcon, MicIcon, MicOffIcon } from "lucide-react";
import { useMemo } from "react";
import { EffectChain } from "@/components/audio/effect-chain";
import type { ChannelSelection } from "@/lib/audio";
import { DeckChannelStrip } from "./deck-channel-strip";
import { useDeckContext } from "./deck-context";
import { DeckFooter } from "./deck-footer";
import {
  buildChannelOptions,
  deserializeSelection,
  serializeSelection,
} from "./deck-panel-sections";

type DeviceInputContentProps = {
  deviceLabel: string;
  channelSelection: ChannelSelection;
  channelCount: number;
  isPlaying: boolean;
  isLoading: boolean;
  deckId: "deck-a" | "deck-b";
  onToggleMute: () => void;
  onChannelSelectionChange: (selection: ChannelSelection) => void;
  onChangeDevice: () => void;
  onClear: () => void;
};

export function DeviceInputContent({
  deviceLabel,
  channelSelection,
  channelCount,
  isPlaying,
  isLoading,
  deckId,
  onToggleMute,
  onChannelSelectionChange,
  onChangeDevice,
  onClear,
}: DeviceInputContentProps) {
  const {
    effects,
    effectsTempo,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
    setEffectsTempo,
  } = useDeckContext();
  const isMobile = useIsMobile();

  const channelOptions = useMemo(
    () => buildChannelOptions(channelCount),
    [channelCount]
  );
  const selectedKey = serializeSelection(channelSelection);

  const sharedControls = (
    <>
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2">
        <MicIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-semibold text-sm">
          {deviceLabel}
        </span>
        <Badge
          className="shrink-0"
          variant={isPlaying ? "default" : "secondary"}
        >
          {isPlaying ? "LIVE" : "MUTED"}
        </Badge>
      </div>
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
          onValueChange={(value) =>
            onChannelSelectionChange(deserializeSelection(value))
          }
          value={selectedKey}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channelOptions.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
      <DeckChannelStrip />
    </>
  );

  const effectsPanel = (
    <EffectChain
      deckId={deckId}
      effects={effects}
      onAddEffect={addEffect}
      onRemoveEffect={removeEffect}
      onReorderEffects={reorderEffects}
      onTempoChange={setEffectsTempo}
      onUpdateEffect={updateEffect}
      tempo={effectsTempo}
    />
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Tabs className="flex h-full min-h-0 flex-col" defaultValue="source">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="source">Source</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
          </TabsList>
          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
            value="source"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className="flex w-full min-w-0 max-w-full flex-col gap-3 pr-0 sm:pr-3">
                {sharedControls}
              </div>
            </div>
          </TabsContent>
          <TabsContent
            className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
            value="effects"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {effectsPanel}
            </div>
          </TabsContent>
        </Tabs>
        <DeckFooter
          isDeviceInput
          onChangeDevice={onChangeDevice}
          onClear={onClear}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 pr-3">
          {sharedControls}
          {effectsPanel}
        </div>
      </ScrollArea>
      <DeckFooter
        isDeviceInput
        onChangeDevice={onChangeDevice}
        onClear={onClear}
      />
    </div>
  );
}
