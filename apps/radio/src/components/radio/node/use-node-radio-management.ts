import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { useDiscoveredStationActions } from "@/lib/hooks/use-discovered-station-actions";
import { deleteRadio } from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { laneChannelId } from "@/lib/node-graph/compile";
import {
  addStationNode,
  findStationNode,
  findStationNodes,
  removeNodes,
  setStationRadio,
  syncStationSnapshots,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { getNodePlayback, type NodePlayback } from "@/lib/node-playback";
import { findLiveStation } from "@/lib/stations/external-station-workflow";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

type StationPlayback = Pick<NodePlayback, "setPlaying" | "whenSettled">;

type UseNodeRadioManagementOptions = {
  /** Every saved station, hidden ones included, so snapshots follow hides. */
  savedRadios?: Radio[];
  store?: NodeStore;
  playback?: StationPlayback;
  /** A Station the search bar added or found, e.g. to pan it into view. */
  onStationAdded?: (nodeId: string) => void;
};

/**
 * Station management on the canvas: the search bar adding a Station wired to
 * Speakers and starting it, an empty slot filled from its search, edit,
 * delete, save-discovered, and hide-restore. Hiding a saved station disables
 * its Station node (greyed, lane released) instead of removing it, because
 * membership in a patch is the user's choice.
 */
export function useNodeRadioManagement({
  savedRadios,
  store = nodeStore,
  playback = getNodePlayback(),
  onStationAdded,
}: UseNodeRadioManagementOptions = {}) {
  const sessionRadios = useSessionRadios((state) => state.radios);
  const removeSessionRadio = useSessionRadios(
    (state) => state.removeSessionRadio
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  // A hidden Station's lane is released; remember which ones were playing
  // so the toast's Undo can bring them back playing.
  const hiddenWhilePlaying = useRef(new Set<string>());

  // Snapshots follow their live records: an edit here or in Settings, a
  // hide or show, or a session station saved under its new id. It runs when
  // the records change (and once a patch loads), not on every graph edit, so
  // a record that lags an edit here cannot undo it.
  const hasGraph = useStore(store, (state) => state.graph !== null);
  useEffect(() => {
    if (!(hasGraph && savedRadios)) {
      return;
    }
    const live = [...savedRadios, ...sessionRadios];
    commitNodeGraph(
      (current) =>
        syncStationSnapshots(current, (radio) => findLiveStation(live, radio)),
      store
    );
  }, [hasGraph, savedRadios, sessionRadios, store]);

  const startStation = async (nodeId: string) => {
    await playback.whenSettled();
    if (!getPlaybackChannelRuntime(laneChannelId(nodeId)).isPlaying) {
      await playback.setPlaying(nodeId, true);
    }
  };

  /** Adds a Station for `radio` wired to Speakers, and starts it. */
  const addStation = async (radio: Radio) => {
    let nodeId: string | null = null;
    commitNodeGraph((current) => {
      const { graph, nodeId: added } = addStationNode(current, radio);
      nodeId = added;
      return graph;
    }, store);
    if (nodeId) {
      onStationAdded?.(nodeId);
      await startStation(nodeId);
    }
    return nodeId;
  };

  /** Fills an empty Station slot, or swaps a Station's radio, and starts it. */
  const fillStation = async (nodeId: string, radio: Radio) => {
    const committed = commitNodeGraph(
      (current) => setStationRadio(current, nodeId, radio),
      store
    );
    if (committed) {
      await startStation(nodeId);
    }
  };

  const { saveDiscoveredStation, selectDiscoveredStation } =
    useDiscoveredStationActions(async (radio) => {
      await addStation(radio);
    });

  const selectDiscoveredForStation = (nodeId: string, radio: Radio) => {
    selectDiscoveredStation(radio, (resolved) => fillStation(nodeId, resolved));
  };

  const removeStations = (radio: Radio) => {
    const ids = store.state.graph
      ? findStationNodes(store.state.graph, radio).map((node) => node.id)
      : [];
    if (ids.length > 0) {
      commitNodeGraph((current) => removeNodes(current, ids), store);
    }
  };

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    if (isSessionRadio(radio)) {
      if (radio.id) {
        removeSessionRadio(radio.id);
        removeStations(radio);
      }
      return;
    }
    setDeleteConfirm(radio);
  };

  const handleSaveSessionRadio = (radio: Radio) => {
    saveDiscoveredStation(radio);
  };

  const handleToggleRadio = async (radio: Radio, enabled: boolean) => {
    // RadioItemActions persists the change; this disables or re-enables the
    // Station without waiting for the snapshot sync.
    const node = store.state.graph
      ? findStationNode(store.state.graph, radio)
      : undefined;
    if (!node?.data.radio) {
      return;
    }
    if (
      !enabled &&
      getPlaybackChannelRuntime(laneChannelId(node.id)).isPlaying
    ) {
      hiddenWhilePlaying.current.add(node.id);
    }
    const snapshot = { ...node.data.radio, enabled };
    commitNodeGraph(
      (current) => setStationRadio(current, node.id, snapshot),
      store
    );
    if (enabled && hiddenWhilePlaying.current.delete(node.id)) {
      await startStation(node.id);
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirm?.id) {
      return;
    }

    try {
      deleteRadio(String(deleteConfirm.id));
      removeStations(deleteConfirm);
      toast.success(`Deleted "${deleteConfirm.name}"`);
      setDeleteConfirm(null);
    } catch {
      toast.error("Couldn't delete station");
    }
  };

  return {
    addStation,
    confirmDelete,
    deleteConfirm,
    dialogMode,
    dialogOpen,
    fillStation,
    handleDeleteRadio,
    handleEditRadio,
    handleSaveSessionRadio,
    handleToggleRadio,
    saveDiscoveredStation,
    selectDiscoveredForStation,
    selectDiscoveredStation,
    selectedRadio,
    sessionRadios,
    setDeleteConfirm,
    setDialogOpen,
  };
}

export type NodeRadioManagement = ReturnType<typeof useNodeRadioManagement>;
