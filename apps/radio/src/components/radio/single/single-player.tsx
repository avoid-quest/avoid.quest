/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { useEffect, useState } from "react";
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
  // Handled by RadioItemActions. Hiding the current Station keeps it playing;
  // the panel shows its live record, so its menu then offers Show.
}

/** Space toggles playback unless the key already activates something else. */
const SPACE_SHORTCUT_IGNORED_TARGETS =
  "input, textarea, select, button, a, summary, [role=slider], [role=menuitem], [role=option], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=combobox], [role=dialog], [role=menu]";

export function SinglePlayer({ radios }: SinglePlayerProps) {
  const {
    currentRadio,
    isPlaying,
    isLoading,
    isMuted,
    error,
    volume,
    playRadio,
    selectRadio,
    togglePlayPause,
    setVolume,
    toggleMute,
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
  // A search pick means "listen to it", so it plays even when paused.
  const { saveDiscoveredStation, selectDiscoveredStation } =
    useDiscoveredStationActions(playRadio);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  // Nothing selected (cold start, or the station was deleted): show the
  // first station paused instead of an empty panel.
  useEffect(() => {
    const [first] = radios ?? [];
    if (!currentRadio && first) {
      selectRadio(first);
    }
  }, [currentRadio, radios, selectRadio]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.repeat ||
        event.defaultPrevented ||
        !currentRadio
      ) {
        return;
      }
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(SPACE_SHORTCUT_IGNORED_TARGETS))
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

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
  };
  const handleCancelDelete = () => setDeleteConfirm(null);
  const currentRadioActions = currentRadio ? (
    <RadioItemActions
      onDelete={handleDeleteRadio}
      onEdit={handleEditRadio}
      onSave={handleSaveSessionRadio}
      onToggle={handleToggleRadio}
      radio={currentRadio}
    />
  ) : null;

  return (
    <>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 py-3 lg:flex-row">
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50 lg:flex-row sm:[@media(max-height:600px)]:flex-row">
          <MobileNowPlayingPanel
            actions={currentRadioActions}
            error={error}
            isLoading={isLoading}
            isMuted={isMuted}
            isPlaying={isPlaying}
            metadata={metadata}
            onMuteToggle={toggleMute}
            onPlayPause={togglePlayPause}
            onVolumeChange={handleVolumeChange}
            radio={currentRadio}
            volume={volume}
          />

          <StationList
            currentRadioId={currentRadio?.id}
            isPlaying={isPlaying && !isLoading}
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
                onSelectLocal={playRadio}
                radios={radios ?? []}
              />
            }
            sessionRadios={sessionRadios}
          />

          <div className="relative hidden min-h-0 flex-1 items-center justify-center p-6 lg:flex">
            <NowPlayingPanel
              actions={currentRadioActions}
              error={error}
              isLoading={isLoading}
              isMuted={isMuted}
              isPlaying={isPlaying}
              metadata={metadata}
              onMuteToggle={toggleMute}
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
