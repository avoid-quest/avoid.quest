/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { useCallback, useEffect } from "react";
import type { Radio } from "@/lib/audio";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useMultipleSession } from "@/lib/hooks/use-multiple-session";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
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
    toggleMute,
    setGlobalVolume,
    toggleGlobalMute,
    playAll,
    pauseAll,
  } = useMultipleSession();

  const {
    sessionRadios,
    saveDiscoveredStation,
    selectDiscoveredStation,
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
    addRadio,
    hasMultipleSession: Boolean(session),
    radios,
    removeRadio,
    syncRadios,
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

  const handleToggleMute = (radio: Radio) => {
    const player = getPlayerState(radio);
    if (player) {
      toggleMute(player.id);
    }
  };
  const handleGlobalVolumeChange = (value: number[]) => {
    setGlobalVolume(value[0] ?? 1);
  };
  const revealCard = (radio: Radio) => {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-radio-id="${String(radio.id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  const handleSelectLocal = (radio: Radio) => {
    addRadio(radio, true);
    revealCard(radio);
  };
  const handleCancelDelete = () => setDeleteConfirm(null);

  const allRadios = [
    ...sessionRadios,
    ...(radios ?? []).filter(
      (r) => !sessionRadios.some((sr) => sr.id === r.id)
    ),
  ];

  const isAnyPlaying = players.some((p) => p.isPlaying);
  const playingCount = players.filter((p) => p.isPlaying).length;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || allRadios.length === 0) {
        return;
      }
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, button, a, [role=slider]"))
      ) {
        return;
      }
      event.preventDefault();
      if (isAnyPlaying) {
        pauseAll();
      } else {
        playAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [allRadios.length, isAnyPlaying, pauseAll, playAll]);

  useMediaSession({
    mode: "multiple",
    playingCount,
    radios: allRadios,
  });

  if (allRadios.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col items-center px-4 py-6">
        <RadioSearchBar
          className="w-full max-w-md"
          onSaveDiscovered={saveDiscoveredStation}
          onSelectDiscovered={selectDiscoveredStation}
          onSelectLocal={handleSelectLocal}
          placeholder="Search to add a station"
          radios={radios ?? []}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-auto px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RadioSearchBar
          className="min-w-56 flex-1"
          onSaveDiscovered={saveDiscoveredStation}
          onSelectDiscovered={selectDiscoveredStation}
          onSelectLocal={handleSelectLocal}
          radios={radios ?? []}
        />
        <MultipleGlobalControls
          globalMuted={globalMuted}
          globalVolume={globalVolume}
          isAnyPlaying={isAnyPlaying}
          onToggleMute={toggleGlobalMute}
          onTogglePlayback={isAnyPlaying ? pauseAll : playAll}
          onVolumeChange={handleGlobalVolumeChange}
          playingCount={playingCount}
          totalCount={allRadios.length}
        />
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
            onToggleMute={handleToggleMute}
            onTogglePlayPause={handleTogglePlayPause}
            onVolumeChange={handleVolumeChange}
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

      <ConfirmDeleteDialog
        onCancel={handleCancelDelete}
        onConfirm={confirmDelete}
        radio={deleteConfirm}
      />
    </div>
  );
}
