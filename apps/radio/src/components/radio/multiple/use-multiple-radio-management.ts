import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { getMultipleChannelId } from "@/lib/collections/playback-sessions";
import { useDiscoveredStationActions } from "@/lib/hooks/use-discovered-station-actions";
import { deleteRadio } from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

type UseMultipleRadioManagementOptions = {
  radios?: Radio[];
  hasMultipleSession: boolean;
  syncRadios: (saved: Radio[], session: Radio[]) => void;
  addRadio: (radio: Radio, persistSelection?: boolean) => void;
  removeRadio: (playerId: string) => void;
};

export function useMultipleRadioManagement({
  radios,
  hasMultipleSession,
  syncRadios,
  addRadio,
  removeRadio,
}: UseMultipleRadioManagementOptions) {
  const sessionRadios = useSessionRadios((state) => state.radios);
  const removeSessionRadio = useSessionRadios(
    (state) => state.removeSessionRadio
  );

  const handleResolved = useCallback(
    (radio: Radio) => {
      addRadio(radio, true);
    },
    [addRadio]
  );
  const { saveDiscoveredStation, selectDiscoveredStation } =
    useDiscoveredStationActions(handleResolved);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  // Hiding removes the card's Channel; remember which ones were playing so
  // the toast's Undo can bring them back playing.
  const hiddenWhilePlaying = useRef(new Set<string>());

  useEffect(() => {
    if (!(radios && hasMultipleSession)) {
      return;
    }
    syncRadios(radios, sessionRadios);
  }, [hasMultipleSession, radios, sessionRadios, syncRadios]);

  const handleEditRadio = useCallback((radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  }, []);

  const handleDeleteRadio = useCallback(
    (radio: Radio) => {
      if (isSessionRadio(radio)) {
        if (radio.id) {
          removeSessionRadio(radio.id);
          removeRadio(getMultipleChannelId(radio));
        }
        return;
      }
      setDeleteConfirm(radio);
    },
    [removeRadio, removeSessionRadio]
  );

  const handleSaveSessionRadio = useCallback(
    (radio: Radio) => {
      saveDiscoveredStation(radio);
    },
    [saveDiscoveredStation]
  );

  const handleToggleRadio = useCallback(
    async (radio: Radio, enabled: boolean) => {
      // RadioItemActions persists the change; this only restores playback.
      const channelId = getMultipleChannelId(radio);
      if (!enabled) {
        if (getPlaybackChannelRuntime(channelId).isPlaying) {
          hiddenWhilePlaying.current.add(channelId);
        }
        return;
      }
      if (hiddenWhilePlaying.current.delete(channelId)) {
        await addRadio(radio, true);
      }
    },
    [addRadio]
  );

  const confirmDelete = useCallback(() => {
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
  }, [deleteConfirm]);

  return {
    confirmDelete,
    deleteConfirm,
    dialogMode,
    dialogOpen,
    handleDeleteRadio,
    handleEditRadio,
    handleSaveSessionRadio,
    handleToggleRadio,
    saveDiscoveredStation,
    selectDiscoveredStation,
    selectedRadio,
    sessionRadios,
    setDeleteConfirm,
    setDialogOpen,
  };
}
