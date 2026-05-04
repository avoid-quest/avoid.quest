import { Button } from "@avoid.quest/ui/components/button";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { useMediaSession } from "@/lib/hooks/use-media-session";
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
import { useSingleSession } from "@/lib/hooks/use-single-session";
import { RadioDialog } from "../../settings/radio-dialog";
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

export function SinglePlayer({ radios }: SinglePlayerProps) {
  const { data: settings } = useSettings();
  const transitionDuration =
    settings?.player?.single?.transitionDuration ?? 2000;
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
  } = useSingleSession(transitionDuration);

  useMediaSession({ mode: "single", radio: currentRadio, isPlaying });

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  const [unmutedVolume, setUnmutedVolume] = useState(1);
  const isMuted = volume <= 0;

  useEffect(() => {
    if (volume > 0) {
      setUnmutedVolume(volume);
    }
  }, [volume]);

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

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 py-3 lg:flex-row">
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50 lg:flex-row">
        {/* Mobile: now playing panel */}
        <MobileNowPlayingPanel
          error={error}
          isCrossfading={isCrossfading}
          isLoading={isLoading}
          isMuted={isMuted}
          isPlaying={isPlaying}
          onDelete={handleDeleteRadio}
          onEdit={handleEditRadio}
          onMuteToggle={handleMuteToggle}
          onPlayPause={togglePlayPause}
          onSave={handleSaveSessionRadio}
          onToggle={handleToggleRadio}
          onVolumeChange={handleVolumeChange}
          radio={currentRadio}
          volume={volume}
        />

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
