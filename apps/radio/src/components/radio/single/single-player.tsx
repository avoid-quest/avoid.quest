import { Button } from "@avoid.quest/ui/components/button";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  AudioLinesIcon,
  Music2Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Radio, useSingleAudio } from "@/lib/audio";
import { deleteRadio } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSingleStore } from "@/lib/stores/single-store";
import { RadioDialog } from "../../settings/radio-dialog";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";

function useSingleStoreHydration(
  selectRadio: (radio: Radio) => Promise<void>,
  setVolume: (volume: number) => void
) {
  const { data: settings } = useSettings();
  const hasHydratedRef = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const selectRadioRef = useRef(selectRadio);
  const setVolumeRef = useRef(setVolume);
  useEffect(() => {
    selectRadioRef.current = selectRadio;
    setVolumeRef.current = setVolume;
  }, [selectRadio, setVolume]);

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }

    if (
      settings !== undefined &&
      settings?.player?.restoreStateOnLoad === false
    ) {
      hasHydratedRef.current = true;
      setIsHydrated(true);
      return;
    }

    const shouldRestore = settings?.player?.restoreStateOnLoad !== false;
    if (shouldRestore && settings !== undefined) {
      hasHydratedRef.current = true;

      (async () => {
        await useSingleStore.persist.rehydrate();
        const { radio, volume } = useSingleStore.getState();

        if (volume !== undefined) {
          setVolumeRef.current(volume);
        }

        if (radio) {
          await selectRadioRef.current(radio);
        }

        setIsHydrated(true);
      })();
    }
  }, [settings]);

  return isHydrated;
}

function NowPlayingPanel({
  radio,
  isPlaying,
  isLoading,
  isCrossfading,
  error,
  volume,
  isMuted,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
}: {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  isCrossfading: boolean;
  error: string | null;
  volume: number;
  isMuted: boolean;
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onMuteToggle: () => void;
}) {
  if (!radio) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Music2Icon className="size-12 text-muted-foreground/15" />
        <p className="font-mono text-muted-foreground/40 text-xs uppercase tracking-wider">
          Select a station
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative size-52 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-black/20 shadow-black/5 shadow-lg">
        {radio.logoUrl ? (
          <img
            alt={radio.name}
            className="h-full w-full object-contain"
            height={208}
            src={radio.logoUrl}
            width={208}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2Icon className="size-12 text-muted-foreground/20" />
          </div>
        )}
        {(isLoading || isCrossfading) && (
          <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
        )}
      </div>

      <div className="w-full max-w-sm text-center">
        <p className="truncate font-semibold text-lg">{radio.name}</p>
        {radio.description && (
          <p className="mt-1 text-muted-foreground/60 text-sm leading-relaxed">
            {radio.description}
          </p>
        )}
      </div>

      {!!error?.trim() && (
        <div className="rounded-md bg-destructive/10 px-3 py-1.5">
          <p className="font-mono text-destructive text-xs">{error}</p>
        </div>
      )}

      <div className="flex w-full max-w-md flex-col items-center gap-5">
        <PlayPauseButton
          className="size-14"
          disabled={isLoading || isCrossfading}
          iconClassName="size-6"
          isLoading={isLoading || isCrossfading}
          isPlaying={isPlaying}
          onClick={onPlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />

        <div className="flex w-full items-center gap-2.5">
          <button
            aria-label={isMuted ? "Unmute" : "Mute"}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            onClick={onMuteToggle}
            type="button"
          >
            {isMuted ? (
              <VolumeXIcon className="size-4" />
            ) : (
              <Volume2Icon className="size-4" />
            )}
          </button>
          <Slider
            className="h-2 flex-1"
            defaultValue={[1]}
            max={1}
            min={0}
            onValueChange={onVolumeChange}
            step={0.01}
            value={[volume]}
          />
          <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function StationList({
  radios,
  currentRadioId,
  onSelect,
  onEdit,
  onDelete,
}: {
  radios: Radio[] | undefined;
  currentRadioId: string | number | undefined;
  onSelect: (radio: Radio) => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
}) {
  return (
    <div className="flex min-h-0 w-full flex-col border-border/50 lg:w-72 lg:shrink-0 lg:border-r">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
          Stations
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {radios?.length ?? 0}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {radios && radios.length > 0 ? (
          <div className="flex flex-col gap-1 px-1.5 pb-1.5">
            {radios.map((radio) => (
              <div
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
                  currentRadioId === radio.id
                    ? "bg-primary/10"
                    : "hover:bg-muted/40"
                )}
                key={radio.id}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onSelect(radio)}
                  type="button"
                >
                  <RadioLogo
                    logoUrl={radio.logoUrl}
                    name={radio.name}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm leading-snug">
                      {radio.name}
                    </p>
                    {radio.description && (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground/60 text-xs leading-snug">
                        {radio.description}
                      </p>
                    )}
                  </div>
                </button>
                <div className="shrink-0 opacity-0 group-hover:opacity-100">
                  <RadioItemActions
                    onDelete={onDelete}
                    onEdit={onEdit}
                    radio={radio}
                  />
                </div>
              </div>
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

type SinglePlayerProps = {
  radios?: Radio[];
};

export function SinglePlayer({ radios }: SinglePlayerProps) {
  const transitionDuration = useSingleStore((s) => s.transitionDuration);
  const {
    currentRadio,
    isPlaying,
    isLoading,
    isCrossfading,
    error,
    volume,
    selectRadio,
    togglePlayPause,
    setVolume,
  } = useSingleAudio(transitionDuration);

  const isHydrated = useSingleStoreHydration(selectRadio, setVolume);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    useSingleStore.getState().setRadio(currentRadio);
  }, [currentRadio, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    useSingleStore.getState().setVolume(volume);
  }, [volume, isHydrated]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [unmutedVolume, setUnmutedVolume] = useState(1);

  useEffect(() => {
    if (!isMuted) {
      setUnmutedVolume(volume);
    }
  }, [volume, isMuted]);

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    setDeleteConfirm(radio);
  };

  const confirmDelete = () => {
    if (!deleteConfirm?.id) {
      return;
    }
    try {
      deleteRadio(String(deleteConfirm.id));
      setDeleteConfirm(null);
    } catch {
      toast.error("Failed to delete radio");
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0] ?? 0;
    setVolume(newVolume);
    if (isMuted && newVolume > 0) {
      setUnmutedVolume(newVolume);
      setIsMuted(false);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      setVolume(unmutedVolume);
      setIsMuted(false);
    } else {
      setUnmutedVolume(volume);
      setVolume(0);
      setIsMuted(true);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 py-3 lg:flex-row">
      <div className="flex h-full min-h-0 w-full overflow-hidden rounded-lg border border-border/50 bg-card/50">
        <StationList
          currentRadioId={currentRadio?.id}
          onDelete={handleDeleteRadio}
          onEdit={handleEditRadio}
          onSelect={(radio) => selectRadio(radio)}
          radios={radios}
        />

        {/* Now playing — desktop */}
        <div className="hidden min-h-0 flex-1 items-center justify-center p-6 lg:flex">
          <NowPlayingPanel
            error={error}
            isCrossfading={isCrossfading}
            isLoading={isLoading}
            isMuted={isMuted}
            isPlaying={isPlaying}
            onMuteToggle={handleMuteToggle}
            onPlayPause={togglePlayPause}
            onVolumeChange={handleVolumeChange}
            radio={currentRadio}
            volume={volume}
          />
        </div>

        {/* Mobile: inline player bar */}
        {currentRadio && (
          <div className="flex items-center gap-2.5 border-border/50 border-t px-3 py-2 lg:hidden">
            <RadioLogo
              logoUrl={currentRadio.logoUrl}
              name={currentRadio.name}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-sm leading-tight">
                {currentRadio.name}
              </p>
            </div>
            <PlayPauseButton
              className="size-8 shrink-0"
              disabled={isLoading || isCrossfading}
              iconClassName="size-4"
              isLoading={isLoading || isCrossfading}
              isPlaying={isPlaying}
              onClick={togglePlayPause}
              size="sm"
              variant={isPlaying && !isLoading ? "outline" : "default"}
            />
            <div className="flex w-20 shrink-0 items-center gap-1">
              <button
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
                onClick={handleMuteToggle}
                type="button"
              >
                {isMuted ? (
                  <VolumeXIcon className="size-3" />
                ) : (
                  <Volume2Icon className="size-3" />
                )}
              </button>
              <Slider
                className="h-1.5 flex-1"
                defaultValue={[1]}
                max={1}
                min={0}
                onValueChange={handleVolumeChange}
                step={0.01}
                value={[volume]}
              />
            </div>
          </div>
        )}
      </div>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border/50 bg-card p-6">
            <h3 className="mb-2 font-semibold text-sm">Delete Radio Station</h3>
            <p className="mb-4 text-muted-foreground text-xs">
              Are you sure you want to delete &ldquo;{deleteConfirm.name}
              &rdquo;? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setDeleteConfirm(null)}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
              <Button onClick={confirmDelete} size="sm" variant="destructive">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
