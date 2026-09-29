/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { useDiscoveredStationActions } from "@/lib/hooks/use-discovered-station-actions";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { deleteRadio } from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { useSingleSession } from "@/lib/hooks/use-single-session";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
import { RadioItemActions } from "../radio-item-actions";
import { RadioSearchBar } from "../radio-search-bar";
import {
  MobileNowPlayingPanel,
  NowPlayingPanel,
} from "./single-player-now-playing";
import { StationList } from "./single-player-station-list";

type SinglePlayerProps = {
  radios?: Radio[];
};

async function handleToggleRadio(_radio: Radio, _enabled: boolean) {
  // Handled by RadioItemActions component
}

export function SinglePlayer({ radios }: SinglePlayerProps) {
  const {
    currentRadio,
    isPlaying,
    isLoading,
    error,
    volume,
    selectRadio,
    togglePlayPause,
    setVolume,
  } = useSingleSession();

  const { metadata } = useRadioMetadata({
    poll: isPlaying && !isLoading,
    radio: currentRadio,
  });

  useMediaSession({
    isPlaying,
    metadata,
    mode: "single",
    radio: currentRadio,
  });

  const sessionRadios = useSessionRadios((s) => s.radios);
  const removeSessionRadio = useSessionRadios((s) => s.removeSessionRadio);
  const handleResolved = useCallback(
    async (radio: Radio) => {
      await selectRadio(radio);
    },
    [selectRadio]
  );
  const { saveDiscoveredStation, selectDiscoveredStation } =
    useDiscoveredStationActions(handleResolved);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  const [unmutedVolume, setUnmutedVolume] = useState(1);
  const isMuted = volume <= 0;
  // Nothing selected (cold start, or the station was deleted): show the
  // first station paused instead of an empty panel.
  useEffect(() => {
    const [first] = radios ?? [];
    if (!currentRadio && first) {
      selectRadio(first);
    }
  }, [currentRadio, radios, selectRadio]);

  useEffect(() => {
    if (volume > 0) {
      setUnmutedVolume(volume);
    }
  }, [volume]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || !currentRadio) {
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
      togglePlayPause();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentRadio, togglePlayPause]);

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    if (isSessionRadio(radio)) {
      if (radio.id) {
        removeSessionRadio(radio.id);
        toast.success(`Removed "${radio.name}"`);
      }
      return;
    }
    setDeleteConfirm(radio);
  };

  const handleSaveSessionRadio = (radio: Radio) => {
    saveDiscoveredStation(radio);
  };

  const confirmDelete = () => {
    if (!deleteConfirm?.id) {
      return;
    }
    try {
      deleteRadio(String(deleteConfirm.id));
      toast.success(`Deleted "${deleteConfirm.name}"`);
      setDeleteConfirm(null);
    } catch {
      toast.error("Couldn't delete station");
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0] ?? 0;
    setVolume(newVolume);
    if (newVolume > 0) {
      setUnmutedVolume(newVolume);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      setVolume(unmutedVolume > 0 ? unmutedVolume : 1);
    } else {
      setUnmutedVolume(volume);
      setVolume(0);
    }
  };
  const handleCancelDelete = () => setDeleteConfirm(null);

  return (
    <>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 py-3 lg:flex-row">
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50 lg:flex-row">
          <MobileNowPlayingPanel
            error={error}
            isLoading={isLoading}
            isMuted={isMuted}
            isPlaying={isPlaying}
            metadata={metadata}
            onMuteToggle={handleMuteToggle}
            onPlayPause={togglePlayPause}
            onVolumeChange={handleVolumeChange}
            radio={currentRadio}
            volume={volume}
          />

          <StationList
            currentRadioId={currentRadio?.id}
            isPlaying={isPlaying}
            onDelete={handleDeleteRadio}
            onEdit={handleEditRadio}
            onSave={handleSaveSessionRadio}
            onSelect={selectRadio}
            onToggle={handleToggleRadio}
            onTogglePlayPause={togglePlayPause}
            radios={radios}
            searchBar={
              <RadioSearchBar
                onSaveDiscovered={saveDiscoveredStation}
                onSelectDiscovered={selectDiscoveredStation}
                onSelectLocal={selectRadio}
                placeholder={`Search ${(radios ?? []).length + sessionRadios.length} stations…`}
                radios={radios ?? []}
              />
            }
            sessionRadios={sessionRadios}
          />

          <div className="relative hidden min-h-0 flex-1 items-center justify-center p-6 lg:flex">
            <NowPlayingPanel
              actions={
                currentRadio ? (
                  <RadioItemActions
                    onDelete={handleDeleteRadio}
                    onEdit={handleEditRadio}
                    onSave={handleSaveSessionRadio}
                    onToggle={handleToggleRadio}
                    radio={currentRadio}
                  />
                ) : null
              }
              error={error}
              isLoading={isLoading}
              isMuted={isMuted}
              isPlaying={isPlaying}
              metadata={metadata}
              onMuteToggle={handleMuteToggle}
              onPlayPause={togglePlayPause}
              onVolumeChange={handleVolumeChange}
              radio={currentRadio}
              volume={volume}
            />
          </div>
        </div>
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
    </>
  );
}
