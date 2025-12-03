import { useSingleAudio } from "@avoid.quest/radio-audio";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { PlayPauseButton } from "@workspace/ui/components/play-pause-button";
import { Slider } from "@workspace/ui/components/slider";
import { AudioLinesIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Radio } from "@/lib/types";
import { RadioDialog } from "../../settings/radio-dialog";
import { SettingsButton } from "../../settings/settings-button";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";

type SinglePlayerProps = {
  radios?: Radio[];
};

export function SinglePlayer({ radios }: SinglePlayerProps) {
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
  } = useSingleAudio();

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

  const handleToggleRadio = async (_radio: Radio, _enabled: boolean) => {
    // This will be handled by RadioItemActions component
  };

  const confirmDelete = async () => {
    if (!deleteConfirm?.id) {
      return;
    }

    try {
      const { db } = await import("@/lib/db");
      await db.radios.delete(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (deleteError) {
      console.error("Failed to delete radio:", deleteError);
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
          {radios?.valueOf() && radios.length > 0 ? (
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
                      onToggle={handleToggleRadio}
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
              variant={
                isPlaying.valueOf() && !isLoading.valueOf()
                  ? "outline"
                  : "default"
              }
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
                  step={0.1}
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
      {deleteConfirm?.valueOf() && (
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
