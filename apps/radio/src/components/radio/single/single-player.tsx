import { Button } from "@avoid.quest/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@avoid.quest/ui/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@avoid.quest/ui/components/item";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { AudioLinesIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Radio, useSingleAudio } from "@/lib/audio";
import { deleteRadio } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSingleStore } from "@/lib/stores/single-store";
import { RadioDialog } from "../../settings/radio-dialog";
import { SettingsButton } from "../../settings/settings-button";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";

// Conditional hydration hook for single store persistence
// Returns true once hydration is complete (or skipped)
function useSingleStoreHydration(
  selectRadio: (radio: Radio) => Promise<void>,
  setVolume: (volume: number) => void
) {
  const { data: settings } = useSettings();
  const hasHydratedRef = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Use refs to avoid stale closures - these always have the latest functions
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

    // If settings loaded and restore is disabled, mark as hydrated immediately
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

        // Restore volume first (before loading radio which might trigger audio)
        if (volume !== undefined) {
          setVolumeRef.current(volume);
        }

        // Then restore radio
        if (radio) {
          await selectRadioRef.current(radio);
        }

        setIsHydrated(true);
      })();
    }
  }, [settings]);

  return isHydrated;
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

  // Conditionally hydrate the single store based on user settings
  const isHydrated = useSingleStoreHydration(selectRadio, setVolume);

  // Sync radio and volume changes to the store (only after hydration to avoid overwriting)
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

  const [isMuted, setIsMuted] = useState(false);
  const [unmutedVolume, setUnmutedVolume] = useState(1);

  useEffect(() => {
    if (!isMuted) {
      setUnmutedVolume(volume);
    }
  }, [volume, isMuted]);

  const handleRadioSelect = async (radio: Radio) => {
    await selectRadio(radio);
  };

  const handlePlayPause = () => {
    togglePlayPause();
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
    <div className="mx-auto grid h-full min-h-0 w-full max-w-7xl grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-2 lg:gap-8">
      {/* Radio List */}
      <Card className="order-last flex min-h-0 flex-col lg:order-first">
        <CardHeader className="hidden lg:block">
          <div className="flex items-center justify-between">
            <CardTitle>Radio Stations</CardTitle>
            <SettingsButton />
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-col p-0">
          {radios && radios.length > 0 ? (
            <ItemGroup className="flex-1 overflow-y-auto py-4">
              {radios.map((radio) => (
                <Item
                  className={`cursor-pointer ${
                    currentRadio?.id === radio.id
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  }`}
                  key={radio.id}
                  onClick={() => handleRadioSelect(radio)}
                >
                  <ItemMedia variant="image">
                    <RadioLogo
                      logoUrl={radio.logoUrl}
                      name={radio.name}
                      size="lg"
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <RadioNameLink radio={radio} />
                    </ItemTitle>
                    {radio.description?.trim() !== "" && (
                      <ItemDescription>{radio.description}</ItemDescription>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <RadioItemActions
                      onDelete={handleDeleteRadio}
                      onEdit={handleEditRadio}
                      radio={radio}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AudioLinesIcon className="mb-4 size-12 text-muted-foreground" />
              <h3 className="mb-2 font-medium text-lg">
                No Radio Stations Available
              </h3>
              <p className="mb-4 text-muted-foreground text-sm">
                All radio stations are currently disabled. Please enable some
                stations in the settings.
              </p>
              <Button size="sm" variant="outline">
                Open Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Player */}
      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex flex-1 flex-col space-y-6 px-4 lg:px-8">
          {currentRadio ? (
            <div className="flex min-h-[120px] min-w-xs items-center gap-4 lg:gap-6">
              {/* Custom image container for better control */}
              <div className="shrink-0">
                <RadioLogo
                  className="rounded-lg"
                  logoUrl={currentRadio.logoUrl}
                  name={currentRadio.name}
                  size="2xl"
                />
              </div>
              <ItemContent>
                <ItemTitle className="text-xl">{currentRadio.name}</ItemTitle>
                {currentRadio.description?.trim() !== "" && (
                  <ItemDescription>{currentRadio.description}</ItemDescription>
                )}
              </ItemContent>
            </div>
          ) : (
            <div className="flex min-h-[120px] min-w-xs items-center justify-center text-center text-muted-foreground">
              Select a radio station to start playing
            </div>
          )}

          {/* Error Display */}
          {!!error?.trim() && (
            <div className="text-destructive text-sm">Error: {error}</div>
          )}

          {/* Player Controls - Compact on mobile, spacious on desktop */}
          <div className="flex items-center gap-3 lg:flex-col lg:gap-6">
            {/* Play/Pause Button - Smaller on mobile */}
            <PlayPauseButton
              className="size-10 shrink-0 lg:size-16"
              disabled={!currentRadio || isLoading || isCrossfading}
              iconClassName="size-6 lg:size-8"
              isLoading={isLoading || isCrossfading}
              isPlaying={isPlaying}
              onClick={handlePlayPause}
              size="sm"
              variant={isPlaying && !isLoading ? "outline" : "default"}
            />

            {/* Volume Controls - Flex row on mobile, full width on desktop */}
            <div className="flex flex-1 items-center gap-2 lg:w-full lg:gap-4">
              <Button
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="size-8 shrink-0 lg:size-10"
                onClick={handleMuteToggle}
                size="sm"
                variant="ghost"
              >
                {isMuted ? (
                  <VolumeXIcon className="size-4 lg:size-5" />
                ) : (
                  <Volume2Icon className="size-4 lg:size-5" />
                )}
              </Button>
              <div className="flex-1">
                <Slider
                  className="w-full"
                  defaultValue={[1]}
                  max={1}
                  min={0}
                  onValueChange={handleVolumeChange}
                  step={0.01}
                  value={[volume]}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-w-md rounded-lg border bg-background p-6">
            <h3 className="mb-2 font-semibold text-lg">Delete Radio Station</h3>
            <p className="mb-4 text-muted-foreground">
              Are you sure you want to delete "{deleteConfirm.name}"? This
              action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeleteConfirm(null)} variant="outline">
                Cancel
              </Button>
              <Button onClick={confirmDelete} variant="destructive">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
