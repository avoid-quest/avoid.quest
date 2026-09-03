// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  FileAudioIcon,
  GlobeIcon,
  MicIcon,
  RadioIcon,
  SearchIcon,
} from "lucide-react";
import { useRef } from "react";
import { EffectChain } from "@/components/audio/effect-chain";
import type { EffectConfig, EffectType } from "@/lib/audio";
import { isAudioFile } from "@/lib/audio/file-metadata";

type DeckEmptyProps = {
  onFileDrop: (file: File) => void;
  effects: EffectConfig[];
  addEffect: (type: EffectType) => void;
  updateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  removeEffect: (effectId: string) => void;
  reorderEffects: (effectIds: string[]) => void;
  className?: string;
};

const SOURCES = [
  {
    hint: "Drag from the browser below",
    icon: RadioIcon,
    label: "Radio stations",
  },
  {
    hint: "MP3, FLAC, WAV, M3U playlists",
    icon: FileAudioIcon,
    label: "Audio files",
  },
  {
    hint: "Search or paste a URL",
    icon: SearchIcon,
    label: "Bandcamp, SoundCloud, YouTube",
  },
  {
    hint: "Direct links, remote streams",
    icon: GlobeIcon,
    label: "Any audio URL",
  },
  {
    hint: "Mic or line-in from your interface",
    icon: MicIcon,
    label: "Audio input",
  },
];

export function DeckEmpty({
  onFileDrop,
  effects,
  addEffect,
  updateEffect,
  removeEffect,
  reorderEffects,
  className,
}: DeckEmptyProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && isAudioFile(file)) {
      onFileDrop(file);
    }
  };
  const handleOpenFile = () => fileInputRef.current?.click();

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex flex-1 flex-col justify-center gap-4 px-3 py-4">
        <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          Load a source
        </p>

        <div className="space-y-1.5">
          {SOURCES.map((source) => (
            <div className="flex items-start gap-2.5" key={source.label}>
              <source.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/30" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs leading-tight">
                  {source.label}
                </p>
                <p className="text-[10px] text-muted-foreground/40 leading-tight">
                  {source.hint}
                </p>
              </div>
            </div>
          ))}
        </div>

        <input
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <Button
          className="h-7 w-full gap-1.5 text-xs"
          onClick={handleOpenFile}
          size="sm"
          variant="outline"
        >
          <FileAudioIcon className="size-3" />
          Open file from disk
        </Button>
      </div>

      {effects.length > 0 && (
        <div className="shrink-0 border-border/50 border-t px-2 py-2">
          <EffectChain
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
            showAddButton={false}
          />
        </div>
      )}
    </div>
  );
}
