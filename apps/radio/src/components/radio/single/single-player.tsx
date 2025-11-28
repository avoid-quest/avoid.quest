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
import { AudioLines, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { useSingleAudio } from "@/lib/audio";
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
    const newVolume = value[0];
    setVolume(newVolume ?? 0);

    if (!isMuted) {
      setUnmutedVolume(newVolume ?? 0);
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
    <div className="mx-auto grid h-full max-w-7xl grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Radio List */}
      <Card className="order-last h-full lg:order-first">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Radio Stations</CardTitle>
            <SettingsButton />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {radios && radios.length > 0 ? (
            <ItemGroup className="max-h-[420px] overflow-y-auto py-4">
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
                    {radio.description && (
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
              <AudioLines className="mb-4 size-12 text-muted-foreground" />
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
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Now Playing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 px-8">
          {currentRadio ? (
            <div className="flex min-h-[120px] min-w-xs items-center gap-6">
              {/* Custom image container for better control */}
              <div className="shrink-0 p-2">
                <RadioLogo
                  className="rounded-lg"
                  logoUrl={currentRadio.logoUrl}
                  name={currentRadio.name}
                  size="2xl"
                />
              </div>
              <ItemContent>
                <ItemTitle className="text-xl">{currentRadio.name}</ItemTitle>
                {currentRadio.description && (
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
          {error && (
            <div className="text-destructive text-sm">Error: {error}</div>
          )}

          {/* Player Controls */}
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-center gap-6">
              <PlayPauseButton
                disabled={!currentRadio || isLoading || isCrossfading}
                isLoading={isLoading || isCrossfading}
                isPlaying={isPlaying}
                onClick={handlePlayPause}
                variant={isPlaying && !isLoading ? "outline" : "default"}
              />
            </div>

            {/* Volume Controls */}
            <div className="flex items-center gap-8">
              <Button
                className="size-10"
                onClick={handleMuteToggle}
                size="sm"
                variant="ghost"
              >
                {isMuted ? (
                  <VolumeX className="size-5" />
                ) : (
                  <Volume2 className="size-5" />
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
                  value={[isMuted ? 0 : volume]}
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
