import { Button } from "@avoid.quest/ui/components/button";
import { AudioLinesIcon } from "lucide-react";
import { useCallback } from "react";
import type { Radio } from "@/lib/audio";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useMultipleSession } from "@/lib/hooks/use-multiple-session";
import { RadioDialog } from "../../settings/radio-dialog";
import { RadioSearchBar } from "../radio-search-bar";
import { MultipleGlobalControls } from "./multiple-global-controls";
import { MultipleRadioCard } from "./multiple-radio-card";
import { useMultipleRadioManagement } from "./use-multiple-radio-management";

export function MultipleRadios({ radios }: { radios?: Radio[] }) {
  const {
    session,
    players,
    globalVolume,
    globalMuted,
    syncRadios,
    addRadio,
    removeRadio,
    togglePlayPause,
    setVolume,
    setGlobalVolume,
    toggleGlobalMute,
    playAll,
    pauseAll,
  } = useMultipleSession();

  const {
    sessionRadios,
    resolve,
    saveToCollection,
    selectDiscoveredStation,
    isResolving,
    dialogOpen,
    setDialogOpen,
    dialogMode,
    selectedRadio,
    deleteConfirm,
    setDeleteConfirm,
    handleEditRadio,
    handleDeleteRadio,
    handleSaveSessionRadio,
    handleToggleRadio,
    confirmDelete,
  } = useMultipleRadioManagement({
    radios,
    hasMultipleSession: Boolean(session),
    syncRadios,
    addRadio,
    removeRadio,
  });

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

  const handleGlobalVolumeChange = (value: number[]) => {
    setGlobalVolume(value[0] ?? 1);
  };

  const allRadios = [
    ...(radios ?? []),
    ...sessionRadios.filter((sr) => !radios?.some((r) => r.id === sr.id)),
  ];

  const isAnyPlaying = players.some((p) => p.isPlaying);
  const playingCount = players.filter((p) => p.isPlaying).length;

  useMediaSession({
    mode: "multiple",
    radios: allRadios,
    playingCount,
  });

  if (allRadios.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col items-center px-4 py-6">
        <RadioSearchBar
          className="mb-4 w-full max-w-md"
          isResolving={isResolving}
          onSaveRemote={saveToCollection}
          onSelectDiscovered={selectDiscoveredStation}
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
        onSelectDiscovered={selectDiscoveredStation}
        onSelectLocal={(radio) => addRadio(radio, true)}
        onSelectRemote={resolve}
        radios={radios ?? []}
      />

      <MultipleGlobalControls
        globalMuted={globalMuted}
        globalVolume={globalVolume}
        isAnyPlaying={isAnyPlaying}
        onToggleMute={toggleGlobalMute}
        onTogglePlayback={isAnyPlaying ? pauseAll : playAll}
        onVolumeChange={handleGlobalVolumeChange}
      />

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
