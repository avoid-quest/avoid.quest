import type { EffectConfig } from "@avoid.quest/radio-audio";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { EffectChain } from "@/components/audio/effect-chain";
import type { PlatformMetadata } from "@/lib/external-url/types";
import { PlaylistView } from "./playlist-view";

type DeckSectionsProps = {
  metadata: PlatformMetadata | null;
  currentTrackIndex: number;
  effects: EffectConfig[];
  onAddEffect: (type: string) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffects: (effectIds: string[]) => void;
  onPlayTrack: (streamUrl: string) => void;
  className?: string;
};

function renderEffectsChain({
  effects,
  onAddEffect,
  onRemoveEffect,
  onReorderEffects,
  onUpdateEffect,
}: {
  effects: EffectConfig[];
  onAddEffect: (type: string) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffects: (effectIds: string[]) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
}) {
  return (
    <>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="w-full">
          <EffectChain
            effects={effects}
            onAddEffect={onAddEffect}
            onRemoveEffect={onRemoveEffect}
            onReorderEffects={onReorderEffects}
            onUpdateEffect={onUpdateEffect}
            showAddButton={false}
          />
        </div>
      </div>
      <div className="shrink-0 border-t pt-2">
        <EffectChain
          effects={[]}
          onAddEffect={onAddEffect}
          onRemoveEffect={onRemoveEffect}
          onReorderEffects={onReorderEffects}
          onUpdateEffect={onUpdateEffect}
          showEffectsList={false}
        />
      </div>
    </>
  );
}

export function DeckSections({
  metadata,
  currentTrackIndex,
  effects,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  onPlayTrack,
  className,
}: DeckSectionsProps) {
  const isMobile = useIsMobile();

  // Check if tracklist exists
  const isCollection =
    metadata &&
    ((metadata.platform === "bandcamp" && metadata.itemType === "album") ||
      (metadata.platform === "soundcloud" && metadata.itemType === "playlist"));

  const hasTracklist =
    isCollection && metadata.tracks && metadata.tracks.length > 0;

  // On mobile, only render effects (tracklist is handled at parent level in deck-layout.tsx)
  if (isMobile) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        {renderEffectsChain({
          effects,
          onAddEffect,
          onRemoveEffect,
          onReorderEffects,
          onUpdateEffect,
        })}
      </div>
    );
  }

  // Desktop: Show effects and tracklist in tabs when tracklist exists
  if (hasTracklist && metadata && metadata.tracks) {
    return (
      <Tabs
        className={cn("flex h-full min-h-0 flex-col", className)}
        defaultValue="effects"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="effects">Effects</TabsTrigger>
          <TabsTrigger value="tracklist">Tracklist</TabsTrigger>
        </TabsList>

        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="effects"
        >
          <div className="flex h-full min-h-0 flex-col">
            {renderEffectsChain({
              effects,
              onAddEffect,
              onRemoveEffect,
              onReorderEffects,
              onUpdateEffect,
            })}
          </div>
        </TabsContent>

        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="tracklist"
        >
          <ScrollArea className="h-full min-h-0">
            <div className="w-full pr-4">
              <PlaylistView
                currentTrackIndex={currentTrackIndex}
                onPlayTrack={onPlayTrack}
                showFullList={true}
                tracks={metadata.tracks}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    );
  }

  // Desktop: Only effects (no tracklist)
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {renderEffectsChain({
        effects,
        onAddEffect,
        onRemoveEffect,
        onReorderEffects,
        onUpdateEffect,
      })}
    </div>
  );
}
