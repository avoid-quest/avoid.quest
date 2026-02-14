import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  AudioLinesIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Radio, useMultipleAudio } from "@/lib/audio";
import { useRadioGardenResolve } from "@/lib/hooks/use-radio-garden-resolve";
import {
  addRadio as addRadioToCollection,
  deleteRadio,
} from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { RadioDialog } from "../../settings/radio-dialog";
import { RadioSearchBar } from "../radio-search-bar";
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

  const sessionRadios = useSessionRadios((s) => s.radios);
  const removeSessionRadio = useSessionRadios((s) => s.removeSessionRadio);
  const handleResolved = useCallback(
    (radio: Radio) => {
      addRadio(radio, true);
    },
    [addRadio]
  );
  const { resolve, saveToCollection, isResolving } =
    useRadioGardenResolve(handleResolved);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);

  const addedRadioIdsRef = useRef<Set<string | number>>(new Set());

  useEffect(() => {
    return () => {
      addedRadioIdsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!radios) {
      return;
    }

    const currentRadioIds = new Set(radios.map((r) => r.id).filter(Boolean));

    for (const radio of radios) {
      if (radio.id && !addedRadioIdsRef.current.has(radio.id)) {
        addedRadioIdsRef.current.add(radio.id);
        addRadio(radio, false);
      }
    }

    for (const radioId of addedRadioIdsRef.current) {
      if (!currentRadioIds.has(radioId)) {
        removeRadio(`multi_${radioId}`);
        addedRadioIdsRef.current.delete(radioId);
      }
    }
  }, [radios, addRadio, removeRadio]);

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
    (radio: Radio, vol: number) => {
      const player = players.find((p) => p.radio.id === radio.id);
      if (player) {
        setVolume(player.id, vol);
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
    if (isSessionRadio(radio)) {
      if (radio.id) {
        removeSessionRadio(radio.id);
        removeRadio(`multi_${radio.id}`);
      }
      return;
    }
    setDeleteConfirm(radio);
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

  const handleToggleRadio = async (_radio: Radio, _enabled: boolean) => {
    // Handled by RadioItemActions component
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

  const handleGlobalVolumeChange = (value: number[]) => {
    setGlobalVolume(value[0] ?? 1);
  };

  const isAnyPlaying = players.some((p) => p.isPlaying);

  const allRadios = [
    ...(radios ?? []),
    ...sessionRadios.filter((sr) => !radios?.some((r) => r.id === sr.id)),
  ];

  if (allRadios.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col items-center px-4 py-6">
        <RadioSearchBar
          className="mb-4 w-full max-w-md"
          isResolving={isResolving}
          onSaveRemote={saveToCollection}
          onSelectLocal={(radio) => addRadio(radio, true)}
          onSelectRemote={resolve}
          radios={radios ?? []}
        />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border/50 border-dashed bg-card/50 px-8 py-12">
          <AudioLinesIcon className="size-8 text-muted-foreground/30" />
          <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            No stations enabled
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-auto px-4 py-6">
      {/* Search bar */}
      <RadioSearchBar
        className="mb-4"
        isResolving={isResolving}
        onSaveRemote={saveToCollection}
        onSelectLocal={(radio) => addRadio(radio, true)}
        onSelectRemote={resolve}
        radios={radios ?? []}
      />

      {/* Global controls bar */}
      <div className="mb-4 flex shrink-0 items-center gap-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
        <Button
          className="h-9 gap-2 text-sm"
          onClick={isAnyPlaying ? pauseAll : playAll}
          variant="outline"
        >
          {isAnyPlaying ? (
            <>
              <PauseIcon className="size-4" />
              Pause All
            </>
          ) : (
            <>
              <PlayIcon className="size-4" />
              Play All
            </>
          )}
        </Button>

        <div className="h-5 w-px bg-border/50" />

        <div className="flex flex-1 items-center gap-2.5">
          <button
            aria-label={globalMuted ? "Unmute all" : "Mute all"}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            onClick={toggleGlobalMute}
            type="button"
          >
            {globalMuted ? (
              <VolumeXIcon className="size-4" />
            ) : (
              <Volume2Icon className="size-4" />
            )}
          </button>
          <Slider
            className="h-2 max-w-xs flex-1"
            defaultValue={[1]}
            max={1}
            min={0}
            onValueChange={handleGlobalVolumeChange}
            step={0.01}
            value={[globalVolume]}
          />
          <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
            {Math.round(globalVolume * 100)}%
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {allRadios.map((radio: Radio) => (
          <MultipleRadioCard
            key={radio.id}
            onDelete={handleDeleteRadio}
            onEdit={handleEditRadio}
            onSave={handleSaveSessionRadio}
            onToggle={handleToggleRadio}
            onTogglePlayPause={() => handleTogglePlayPause(radio)}
            onVolumeChange={(vol) => handleVolumeChange(radio, vol)}
            playerState={getPlayerState(radio)}
            radio={radio}
          />
        ))}
      </div>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {/* Delete Confirmation */}
      {deleteConfirm?.valueOf() && (
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
