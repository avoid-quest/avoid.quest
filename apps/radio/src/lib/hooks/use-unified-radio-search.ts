import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";
import type { Radio } from "@/lib/audio";
import type {
  StationDiscoveryResult,
  StationDiscoverySnapshot,
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

export function useUnifiedRadioSearch(query: string, localRadios: Radio[]) {
  const playbackNeedsNetwork = useStore(playbackRuntimeStore, (state) =>
    Object.values(state.channels).some(
      (channel) => channel.isLoading || channel.isBuffering
    )
  );
  const [discovery] = useState(createProductionStationDiscovery);
  const [snapshot, setSnapshot] =
    useState<StationDiscoverySnapshot>(INITIAL_SNAPSHOT);

  useEffect(
    () =>
      discovery.search(
        {
          knownStations: localRadios,
          playbackNeedsNetwork,
          query,
        },
        setSnapshot
      ),
    [discovery, localRadios, playbackNeedsNetwork, query]
  );

  return snapshot;
}
