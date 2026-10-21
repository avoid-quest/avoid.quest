import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { useDiscoveredStationActions } from "@/lib/hooks/use-discovered-station-actions";
import { deleteRadio } from "@/lib/hooks/use-radios";
import {
  isSessionRadio,
  useSessionRadios,
} from "@/lib/hooks/use-session-radios";
import { laneChannelId } from "@/lib/node-graph/compile";
import {
  addStationNode,
  findStationNodes,
  removeNodes,
  setSourceRadio,
  setStationRadio,
  setStationsEnabled,
  syncStationSnapshots,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  getRetainedNodeGraphs,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { type GraphNode, isRadioSourceNode } from "@/lib/node-graph/schema";
import { getNodePlayback, type NodePlayback } from "@/lib/node-playback";
import {
  loadSourceUrl,
  loadStreamStation,
  type NodeSourceLoaderDependencies,
} from "@/lib/node-source-loaders";
import { findLiveStation } from "@/lib/stations/external-station-workflow";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

type StationPlayback = Pick<NodePlayback, "flush" | "setPlaying">;

/** A request and what its source held, as of the last edit it survived. */
type SourceRequest = { source: string };
type SourceRequests = {
  generation: number;
  requests: Map<string, SourceRequest>;
};
const sourceRequests = new WeakMap<NodeStore, SourceRequests>();

/** What a source plays; a cosmetic edit (position, strip, fader) keeps it. */
function sourceOf(node: GraphNode | undefined): string {
  if (!node) {
    return "";
  }
  if (isRadioSourceNode(node)) {
    const { radio } = node.data;
    return JSON.stringify([node.type, radio?.id ?? null, radio?.streamUrl]);
  }
  if (node.type === "deviceIn") {
    const { capture, deviceId, sourceUrl } = node.data;
    return JSON.stringify([node.type, deviceId, capture, sourceUrl]);
  }
  return node.type;
}

/**
 * A replacement has no editor-node lineage; ordinary edits share node data.
 * Undo and Redo bring back other instances of the same nodes, so a request
 * outlives one only if its own source still plays what it did.
 */
function requestsFor(store: NodeStore): SourceRequests {
  const existing = sourceRequests.get(store);
  if (existing) {
    return existing;
  }
  const state: SourceRequests = { generation: 0, requests: new Map() };
  sourceRequests.set(store, state);
  let previous = store.state;
  store.subscribe(() => {
    const next = store.state;
    if (next.graph !== previous.graph) {
      const retained = new Set(
        previous.graph?.nodes.flatMap((node) => [node, node.data]) ?? []
      );
      if (
        next.graph?.nodes.some(
          (node) => retained.has(node) || retained.has(node.data)
        )
      ) {
        const restored = getRetainedNodeGraphs(previous).has(next.graph);
        const nodes = new Map(next.graph.nodes.map((node) => [node.id, node]));
        for (const [id, request] of state.requests) {
          const node = nodes.get(id);
          const source = sourceOf(node);
          if (!node || (restored && source !== request.source)) {
            state.requests.delete(id);
          } else {
            // A forward edit is the request's own fill or follows a record.
            request.source = source;
          }
        }
      } else {
        state.generation += 1;
        state.requests.clear();
      }
    }
    previous = next;
  });
  return state;
}

/** Mode exit and explicit replacement invalidate requests from both views. */
export function invalidateSourceRequests(store: NodeStore = nodeStore): void {
  const state = requestsFor(store);
  state.generation += 1;
  state.requests.clear();
}

/** Latest request for this source in this patch lifecycle, shared by both views. */
export function beginSourceRequest(
  nodeId: string,
  signal?: AbortSignal,
  store: NodeStore = nodeStore
): () => boolean {
  const state = requestsFor(store);
  const { generation } = state;
  const request: SourceRequest = {
    source: sourceOf(
      store.state.graph?.nodes.find((node) => node.id === nodeId)
    ),
  };
  state.requests.set(nodeId, request);
  return () =>
    state.generation === generation &&
    state.requests.get(nodeId) === request &&
    !signal?.aborted;
}

type UseNodeRadioManagementOptions = {
  /** Every saved station, hidden ones included, so snapshots follow hides. */
  savedRadios?: Radio[];
  store?: NodeStore;
  playback?: StationPlayback;
  /** A Station the search bar added or found, e.g. to pan it into view. */
  onStationAdded?: (nodeId: string) => void;
  /** The loaders behind a pasted link; DJ's by default. */
  loaders?: NodeSourceLoaderDependencies;
};

/**
 * Station management on the canvas: the search bar adding a Station wired to
 * Speakers and starting it, an empty slot filled from its search or a
 * pasted stream link, a Track or File filled from its own body, edit,
 * delete, save-discovered, and hide-restore. Hiding a saved station disables
 * its Station node (greyed, lane released) instead of removing it, because
 * membership in a patch is the user's choice.
 */
export function useNodeRadioManagement({
  savedRadios,
  store = nodeStore,
  playback = getNodePlayback(),
  onStationAdded,
  loaders,
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
    // Applied to every undo snapshot too, so an undo never brings a stale
    // record back.
    commitNodeGraph(
      (current) =>
        syncStationSnapshots(current, (radio) => findLiveStation(live, radio)),
      store,
      "rebase"
    );
  }, [hasGraph, savedRadios, sessionRadios, store]);

  // Applies the edit first, then starts without an await in between, so the
  // play call stays inside the click's gesture (mobile Safari) and does not
  // queue behind other Stations still loading.
  const startStation = async (nodeId: string) => {
    playback.flush();
    if (!getPlaybackChannelRuntime(laneChannelId(nodeId)).isPlaying) {
      await playback.setPlaying(nodeId, true);
    }
  };

  /** Adds a Station for `radio` wired to Speakers, and starts it. */
  const addStation = async (radio: Radio) => {
    let nodeId: string | null = null;
    commitNodeGraph(
      (current) => {
        const { graph, nodeId: added } = addStationNode(current, radio);
        nodeId = added;
        return graph;
      },
      store,
      "snapshot"
    );
    if (nodeId) {
      onStationAdded?.(nodeId);
      await startStation(nodeId);
    }
    return nodeId;
  };

  /** Fills an empty Station slot, or swaps a Station's radio, and starts it. */
  const fillStation = async (
    nodeId: string,
    radio: Radio,
    isCurrent = beginSourceRequest(nodeId, undefined, store)
  ) => {
    if (!isCurrent()) {
      return;
    }
    const committed = commitNodeGraph(
      (current) => setStationRadio(current, nodeId, radio),
      store,
      "snapshot"
    );
    if (committed && radio.platformMetadata?.platform !== "device-input") {
      await startStation(nodeId);
    }
  };

  /**
   * Fills a Station, Track or File with `radio`, turning it into the one
   * that plays it (a radio link in a Track hands off to a Station), and
   * starts it.
   */
  const fillSource = async (
    nodeId: string,
    radio: Radio,
    isCurrent = beginSourceRequest(nodeId, undefined, store)
  ) => {
    if (!isCurrent()) {
      return;
    }
    const committed = commitNodeGraph(
      (current) => setSourceRadio(current, nodeId, radio),
      store,
      "snapshot"
    );
    if (committed && radio.platformMetadata?.platform !== "device-input") {
      await startStation(nodeId);
    }
  };

  /**
   * A link pasted into a Station's search: a platform link loads as a DJ
   * deck would (a YouTube link makes it a Track), anything else is a radio
   * stream, kept as a session station. Resolves to why it failed, or null,
   * also when a newer request superseded it before it loaded.
   */
  const fillStationFromUrl = async (
    nodeId: string,
    url: string,
    isCurrent = beginSourceRequest(nodeId, undefined, store)
  ): Promise<string | null> => {
    const loaded = detectPlatformFromUrl(url)
      ? await loadSourceUrl(url, loaders)
      : await loadStreamStation(url, { ...loaders, isCurrent });
    if (!isCurrent()) {
      return null;
    }
    if ("error" in loaded) {
      return loaded.error;
    }
    await fillSource(nodeId, loaded.radio, isCurrent);
    return null;
  };

  const { saveDiscoveredStation, selectDiscoveredStation } =
    useDiscoveredStationActions(async (radio) => {
      await addStation(radio);
    });

  const selectDiscoveredForStation = (nodeId: string, radio: Radio) => {
    const isCurrent = beginSourceRequest(nodeId, undefined, store);
    selectDiscoveredStation(radio, (resolved) =>
      fillStation(nodeId, resolved, isCurrent)
    );
  };

  const removeStations = (radio: Radio) => {
    const ids = store.state.graph
      ? findStationNodes(store.state.graph, radio).map((node) => node.id)
      : [];
    if (ids.length > 0) {
      commitNodeGraph(
        (current) => removeNodes(current, ids),
        store,
        "snapshot"
      );
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
    // Every Station holding it, so a Doppelgänger patch hides as one.
    const nodes = store.state.graph
      ? findStationNodes(store.state.graph, radio)
      : [];
    if (nodes.length === 0) {
      return;
    }
    const resume: string[] = [];
    for (const node of nodes) {
      if (
        !enabled &&
        getPlaybackChannelRuntime(laneChannelId(node.id)).isPlaying
      ) {
        hiddenWhilePlaying.current.add(node.id);
      }
      if (enabled && hiddenWhilePlaying.current.delete(node.id)) {
        resume.push(node.id);
      }
    }
    // The saved record changed too, so every undo snapshot follows it.
    commitNodeGraph(
      (current) =>
        setStationsEnabled(
          current,
          nodes.map((node) => node.id),
          enabled
        ),
      store,
      "rebase"
    );
    await Promise.all(resume.map((nodeId) => startStation(nodeId)));
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
    fillSource,
    fillStation,
    fillStationFromUrl,
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
