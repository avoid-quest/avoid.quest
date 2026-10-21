import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type StationDiscoveryResult,
  type StationDiscoverySnapshot,
  setStationDiscoveryPlaybackNeedsNetwork,
} from "@/lib/stations/station-discovery";
import { createProductionStationDiscovery } from "@/lib/stations/station-discovery-adapters";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

export type UnifiedRadioSearchAction = StationDiscoveryResult["action"];
export type UnifiedRadioSearchResult = StationDiscoveryResult;
export type UnifiedSearchOutput = Omit<StationDiscoverySnapshot, "isSearching">;

const INITIAL_SNAPSHOT: StationDiscoverySnapshot = {
  duplicateCount: 0,
  isSearching: false,
  results: [],
};

export function useUnifiedRadioSearch(
  query: string,
  localRadios: Radio[],
  enabled = true
) {
  const playbackNeedsNetwork = useStore(playbackRuntimeStore, (state) =>
    Object.values(state.channels).some(
      (channel) => channel.isLoading || channel.isBuffering
    )
  );
  const [discovery, setDiscovery] = useState(createProductionStationDiscovery);
  const [snapshot, setSnapshot] =
    useState<StationDiscoverySnapshot>(INITIAL_SNAPSHOT);
  const localRadiosSignature = JSON.stringify(localRadios);
  const latestLocalRadios = useRef({
    signature: localRadiosSignature,
    value: localRadios,
  });

  useEffect(() => {
    latestLocalRadios.current = {
      signature: localRadiosSignature,
      value: localRadios,
    };
  }, [localRadios, localRadiosSignature]);

  useEffect(() => {
    setStationDiscoveryPlaybackNeedsNetwork(playbackNeedsNetwork);
  }, [playbackNeedsNetwork]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot((current) =>
        current.isSearching ? { ...current, isSearching: false } : current
      );
      return;
    }
    if (latestLocalRadios.current.signature !== localRadiosSignature) {
      return;
    }
    return discovery.search(
      {
        knownStations: latestLocalRadios.current.value,
        playbackNeedsNetwork: Object.values(
          playbackRuntimeStore.state.channels
        ).some((channel) => channel.isLoading || channel.isBuffering),
        query,
      },
      setSnapshot
    );
  }, [discovery, enabled, localRadiosSignature, query]);

  return {
    ...snapshot,
    retry: () => setDiscovery(createProductionStationDiscovery()),
  };
}
