import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { getMultipleChannelId } from "@/lib/collections/playback-sessions";
import { useDiscoveredStationActions } from "@/lib/hooks/use-discovered-station-actions";
import { deleteRadio } from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";

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
    async (_radio: Radio, _enabled: boolean) => {
      // Handled by RadioItemActions component
    },
    []
  );

  const confirmDelete = useCallback(() => {
    if (!deleteConfirm?.id) {
      return;
    }

    try {
      deleteRadio(String(deleteConfirm.id));
      setDeleteConfirm(null);
    } catch {
      toast.error("Failed to delete radio");
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
