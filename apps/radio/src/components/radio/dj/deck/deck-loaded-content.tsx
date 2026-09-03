import { Accordion } from "@avoid.quest/ui/components/accordion";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { EffectChain } from "@/components/audio/effect-chain";
import { RadioNowPlaying } from "@/components/radio/radio-now-playing";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { DeckChannelStrip } from "./deck-channel-strip";
import { useDeckContext } from "./deck-context";
import { DeckFooter } from "./deck-footer";
import { AccordionSection } from "./deck-panel-sections";
import { DeckTracklist } from "./deck-tracklist";
import { DeckTransport } from "./deck-transport";

type LoadedDeckContentProps = {
  onChangeUrl?: () => void;
  onClear: () => void;
};

export function LoadedDeckContent({
  onChangeUrl,
  onClear,
}: LoadedDeckContentProps) {
  const {
    effects,
    deckId,
    radio,
    isPlaying,
    isLoading,
    isFileSource,
    hasTracklist,
    tracks,
    currentTrackIndex,
    addEffect,
    updateEffect,
    removeEffect,
    reorderEffects,
    effectsTempo,
    setEffectsTempo,
  } = useDeckContext();
  const isMobile = useIsMobile();
  const { metadata } = useRadioMetadata({
    radio,
    enabled: isPlaying && !isLoading,
  });

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
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5 pr-0 sm:gap-2 sm:pr-3">
            <DeckTransport />
            <RadioNowPlaying
              className="truncate px-1 text-muted-foreground"
              metadata={metadata}
            />
            <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2">
              <DeckChannelStrip />
            </div>
            <Accordion className="space-y-1" defaultValue={[]} type="multiple">
              {hasTracklist && tracks && (
                <AccordionSection
                  title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
                  value="tracks"
                >
                  <DeckTracklist />
                </AccordionSection>
              )}
              <AccordionSection
                title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
                value="effects"
              >
                {effectsPanel}
              </AccordionSection>
            </Accordion>
          </div>
        </div>
        <DeckFooter
          isFileSource={isFileSource}
          onChangeUrl={onChangeUrl}
          onClear={onClear}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DeckTransport />
      <RadioNowPlaying
        className="truncate px-1 text-muted-foreground"
        metadata={metadata}
      />
      <div className="rounded-lg border border-border/50 bg-muted/30 px-2 py-2">
        <DeckChannelStrip />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Accordion
          className="space-y-1"
          defaultValue={["effects"]}
          type="multiple"
        >
          {hasTracklist && tracks && (
            <AccordionSection
              title={`Tracks (${currentTrackIndex + 1}/${tracks.length})`}
              value="tracks"
            >
              <DeckTracklist />
            </AccordionSection>
          )}
          <AccordionSection
            title={`Effects${effects.length > 0 ? ` (${effects.length})` : ""}`}
            value="effects"
          >
            {effectsPanel}
          </AccordionSection>
        </Accordion>
      </ScrollArea>
      <div className="mt-auto">
        <DeckFooter
          isFileSource={isFileSource}
          onChangeUrl={onChangeUrl}
          onClear={onClear}
        />
      </div>
    </div>
  );
}
