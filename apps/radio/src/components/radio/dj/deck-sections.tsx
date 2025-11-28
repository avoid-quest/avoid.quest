import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { EffectChain } from "@/components/audio/effect-chain";
import type { EffectConfig } from "@/lib/audio/effects/types";
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
  const isCollection =
    metadata &&
    ((metadata.platform === "bandcamp" && metadata.itemType === "album") ||
      (metadata.platform === "soundcloud" && metadata.itemType === "playlist"));

  const hasTracklist =
    isCollection && metadata.tracks && metadata.tracks.length > 0;

  // If only effects is available (no tracklist), don't use tabs
  if (!hasTracklist) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
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
      </div>
    );
  }

  // If tracklist exists, use tabs for Effects and Tracklist
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
      </TabsContent>

      {metadata.tracks && (
        <TabsContent
          className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="tracklist"
        >
          <ScrollArea className="h-full min-h-0">
            <div className="w-full pr-4">
              <PlaylistView
                artist={metadata.artist}
                currentTrackIndex={currentTrackIndex}
                onPlayTrack={onPlayTrack}
                tracks={metadata.tracks}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      )}
    </Tabs>
  );
}
