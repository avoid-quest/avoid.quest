import { Badge } from "@avoid.quest/ui/components/badge";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Radio, useSingleAudio } from "@/lib/audio";
import { useRadioGardenResolve } from "@/lib/hooks/use-radio-garden-resolve";
import {
  addRadio as addRadioToCollection,
  deleteRadio,
} from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSingleStore } from "@/lib/stores/single-store";
import { RadioDialog } from "../../settings/radio-dialog";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioSearchBar } from "../radio-search-bar";

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

  const isSession = isSessionRadio(radio);

  return (
    <div className="relative flex flex-col items-center gap-6">
      <div className="relative size-52 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-black/20 shadow-black/5 shadow-lg">
        <RadioLogo
          className="size-52 rounded-xl"
          logoUrl={radio.logoUrl}
          name={radio.name}
          size="4xl"
        />
        {(isLoading || isCrossfading) && (
          <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
        )}
      </div>

      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-1.5">
          <p className="truncate font-semibold text-lg">{radio.name}</p>
          {isSession && (
            <Badge
              className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
              variant="outline"
            >
              Unsaved
            </Badge>
          )}
        </div>
        {radio.placeTitle ? (
          <p className="mt-1 text-muted-foreground/60 text-sm leading-relaxed">
            {radio.placeTitle}, {radio.countryTitle}
          </p>
        ) : (
          radio.description && (
            <p className="mt-1 text-muted-foreground/60 text-sm leading-relaxed">
              {radio.description}
            </p>
          )
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

function StationList({
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
            {allRadios.map((radio) => {
              const isSession = isSessionRadio(radio);
              return (
                <div
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
                    currentRadioId === radio.id
                      ? "bg-primary/10"
                      : "hover:bg-muted/40",
                    isSession && "border-l-2 border-l-[#00d084]/40"
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
                      {isSession && (
                        <Badge
                          className="mt-1 h-4 w-fit border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
                          variant="outline"
                        >
                          Unsaved
                        </Badge>
                      )}
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
            })}
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

  const sessionRadios = useSessionRadios((s) => s.radios);
  const removeSessionRadio = useSessionRadios((s) => s.removeSessionRadio);
  const handleResolved = useCallback(
    async (radio: Radio) => {
      await selectRadio(radio);
    },
    [selectRadio]
  );
  const { resolve, saveToCollection, isResolving } =
    useRadioGardenResolve(handleResolved);

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
    if (isSessionRadio(radio)) {
      if (radio.id) {
        removeSessionRadio(radio.id);
      }
      return;
    }
    setDeleteConfirm(radio);
  };

  const handleToggleRadio = async (_radio: Radio, _enabled: boolean) => {
    // Handled by RadioItemActions component
  };

  const handleSaveSessionRadio = (radio: Radio) => {
    const { id: _id, ...radioData } = radio;
    addRadioToCollection({
      ...radioData,
      order: 0,
      enabled: true,
      isSystem: false,
    });
    if (radio.id) {
      removeSessionRadio(radio.id);
    }
    toast.success(`Saved "${radio.name}" to collection`);
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
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50 lg:flex-row">
        {/* Mobile: now playing panel */}
        {currentRadio && (
          <div className="relative flex shrink-0 flex-col items-center gap-4 border-border/50 border-b px-5 py-5 lg:hidden">
            <div className="absolute top-3 right-3">
              <RadioItemActions
                onDelete={handleDeleteRadio}
                onEdit={handleEditRadio}
                onSave={handleSaveSessionRadio}
                onToggle={handleToggleRadio}
                radio={currentRadio}
              />
            </div>

            <div className="relative size-28 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-black/20 shadow-black/5 shadow-lg">
              <RadioLogo
                className="size-28 rounded-xl"
                logoUrl={currentRadio.logoUrl}
                name={currentRadio.name}
                size="3xl"
              />
              {(isLoading || isCrossfading) && (
                <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
              )}
            </div>

            <div className="w-full text-center">
              <div className="flex items-center justify-center gap-1.5">
                <p className="truncate font-semibold text-lg">
                  {currentRadio.name}
                </p>
                {isSessionRadio(currentRadio) && (
                  <Badge
                    className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
                    variant="outline"
                  >
                    Unsaved
                  </Badge>
                )}
              </div>
              {currentRadio.placeTitle ? (
                <p className="mt-0.5 truncate text-muted-foreground/60 text-sm">
                  {currentRadio.placeTitle}, {currentRadio.countryTitle}
                </p>
              ) : (
                currentRadio.description && (
                  <p className="mt-0.5 truncate text-muted-foreground/60 text-sm">
                    {currentRadio.description}
                  </p>
                )
              )}
            </div>

            {!!error?.trim() && (
              <div className="rounded-md bg-destructive/10 px-3 py-1.5">
                <p className="font-mono text-destructive text-xs">{error}</p>
              </div>
            )}

            <PlayPauseButton
              className="size-14"
              disabled={isLoading || isCrossfading}
              iconClassName="size-6"
              isLoading={isLoading || isCrossfading}
              isPlaying={isPlaying}
              onClick={togglePlayPause}
              size="sm"
              variant={isPlaying && !isLoading ? "outline" : "default"}
            />

            <div className="flex w-full items-center gap-2.5">
              <button
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                onClick={handleMuteToggle}
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
                onValueChange={handleVolumeChange}
                step={0.01}
                value={[volume]}
              />
              <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        )}

        <StationList
          currentRadioId={currentRadio?.id}
          onDelete={handleDeleteRadio}
          onEdit={handleEditRadio}
          onSave={handleSaveSessionRadio}
          onSelect={(radio) => selectRadio(radio)}
          onToggle={handleToggleRadio}
          radios={radios}
          searchBar={
            <RadioSearchBar
              isResolving={isResolving}
              onSaveRemote={saveToCollection}
              onSelectLocal={(radio) => selectRadio(radio)}
              onSelectRemote={resolve}
              radios={radios ?? []}
            />
          }
          sessionRadios={sessionRadios}
        />

        {/* Now playing — desktop */}
        <div className="relative hidden min-h-0 flex-1 items-center justify-center p-6 lg:flex">
          {currentRadio && (
            <div className="absolute top-4 right-4 z-10">
              <RadioItemActions
                onDelete={handleDeleteRadio}
                onEdit={handleEditRadio}
                onSave={handleSaveSessionRadio}
                onToggle={handleToggleRadio}
                radio={currentRadio}
              />
            </div>
          )}
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
