import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { useRadioGardenResolve } from "@/lib/hooks/use-radio-garden-resolve";
import {
  addRadio as addRadioToCollection,
  deleteRadio,
} from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";

type UseMultipleRadioManagementOptions = {
  radios?: Radio[];
  addRadio: (radio: Radio, persistSelection?: boolean) => void;
  removeRadio: (playerId: string) => void;
};

export function useMultipleRadioManagement({
  radios,
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

    const currentRadioIds = new Set(
      radios.map((radio) => radio.id).filter(Boolean)
    );

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
          removeRadio(`multi_${radio.id}`);
        }
        return;
      }
      setDeleteConfirm(radio);
    },
    [removeRadio, removeSessionRadio]
  );

  const handleSaveSessionRadio = useCallback(
    (radio: Radio) => {
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
    },
    [removeSessionRadio]
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
    sessionRadios,
    resolve,
    saveToCollection,
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
  };
}
