import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Slider } from "@workspace/ui/components/slider";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Radio, useMultipleAudio } from "@/lib/audio";
import { RadioDialog } from "../../settings/radio-dialog";
import { SettingsButton } from "../../settings/settings-button";
import { MultipleRadioCard } from "./multiple-radio-card";

export function MultipleRadios({ radios }: { radios?: Radio[] }) {
  const {
    players,
    globalVolume,
    globalMuted,
    addRadio,
    removeRadio,
    togglePlayPause,
    setVolume,
    setGlobalVolume,
    toggleGlobalMute,
    playAll,
    pauseAll,
  } = useMultipleAudio();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);

  // Track which radios we've added to avoid duplicates
  const addedRadioIdsRef = useRef<Set<number>>(new Set());

  // Sync radios with audio players
  useEffect(() => {
    if (!radios) {
      return;
    }

    const currentRadioIds = new Set(radios.map((r) => r.id).filter(Boolean));

    // Add new radios
    for (const radio of radios) {
      if (radio.id && !addedRadioIdsRef.current.has(radio.id)) {
        addedRadioIdsRef.current.add(radio.id);
        addRadio(radio, false);
      }
    }

    // Remove radios that are no longer in the list
    for (const radioId of addedRadioIdsRef.current) {
      if (!currentRadioIds.has(radioId)) {
        const player = players.find((p) => p.radio.id === radioId);
        if (player) {
          removeRadio(player.id);
        }
        addedRadioIdsRef.current.delete(radioId);
      }
    }
  }, [radios, addRadio, removeRadio, players]);

  // Find player state by matching radio ID
  const getPlayerState = useCallback(
    (radio: Radio) => players.find((p) => p.radio.id === radio.id) ?? null,
    [players]
  );

  const handleTogglePlayPause = useCallback(
    (radio: Radio) => {
      const player = players.find((p) => p.radio.id === radio.id);
      if (player) {
        togglePlayPause(player.id);
      }
    },
    [players, togglePlayPause]
  );

  const handleVolumeChange = useCallback(
    (radio: Radio, volume: number) => {
      const player = players.find((p) => p.radio.id === radio.id);
      if (player) {
        setVolume(player.id, volume);
      }
    },
    [players, setVolume]
  );

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    setDeleteConfirm(radio);
  };

  const handleToggleRadio = async (_radio: Radio, _enabled: boolean) => {
    // Handled by RadioItemActions component
  };

  const confirmDelete = async () => {
    if (!deleteConfirm?.id) {
      return;
    }

    try {
      const { db } = await import("@/lib/db");
      await db.radios.delete(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete radio:", error);
    }
  };

  const handleGlobalVolumeChange = (value: number[]) => {
    setGlobalVolume(value[0] ?? 1);
  };

  const isAnyPlaying = players.some((p) => p.isPlaying);

  if (!radios || radios.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl items-center justify-center px-4 py-4">
        <Card className="w-full max-w-md border-dashed">
          <CardHeader>
            <CardTitle className="text-center">
              No Radio Stations Available
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted">
              <Volume2Icon className="size-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              All radio stations are currently disabled. Please enable some
              stations in the settings.
            </p>
            <SettingsButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-h-[calc(100vh-6rem)] min-h-0 w-full max-w-7xl flex-col overflow-auto px-4 py-4">
      {/* Global Controls */}
      <div className="mb-4 flex items-center gap-4 rounded-lg border bg-card p-3">
        <Button
          onClick={isAnyPlaying ? pauseAll : playAll}
          size="sm"
          variant="outline"
        >
          {isAnyPlaying ? (
            <>
              <PauseIcon className="mr-2 size-4" />
              Pause All
            </>
          ) : (
            <>
              <PlayIcon className="mr-2 size-4" />
              Play All
            </>
          )}
        </Button>
        <div className="flex flex-1 items-center gap-2">
          <Button
            aria-label={globalMuted ? "Unmute all" : "Mute all"}
            className="size-8"
            onClick={toggleGlobalMute}
            size="sm"
            variant="ghost"
          >
            {globalMuted ? (
              <VolumeXIcon className="size-4" />
            ) : (
              <Volume2Icon className="size-4" />
            )}
          </Button>
          <Slider
            className="max-w-[200px]"
            max={1}
            min={0}
            onValueChange={handleGlobalVolumeChange}
            step={0.05}
            value={[globalVolume]}
          />
          <span className="text-muted-foreground text-sm">
            {Math.round(globalVolume * 100)}%
          </span>
        </div>
        <SettingsButton />
      </div>

      {/* Radio Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {radios.map((radio: Radio) => (
          <div
            className="group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            key={radio.id}
          >
            <MultipleRadioCard
              onDelete={handleDeleteRadio}
              onEdit={handleEditRadio}
              onToggle={handleToggleRadio}
              onTogglePlayPause={() => handleTogglePlayPause(radio)}
              onVolumeChange={(vol) => handleVolumeChange(radio, vol)}
              playerState={getPlayerState(radio)}
              radio={radio}
            />
          </div>
        ))}
      </div>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm?.valueOf() && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="fade-in zoom-in w-full max-w-md animate-in rounded-lg border bg-background p-6 shadow-xl duration-200">
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
