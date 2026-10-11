import { captureError } from "@avoid.quest/error";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { radios as curatedRadios } from "@/lib/const";
import { createExternalPlatformSearchWorkflow } from "@/lib/external-platform-search-workflow";
import {
  searchBandcamp,
  searchMixcloud,
  searchRadioGarden,
  searchSoundCloud,
} from "@/lib/platform-client";
import {
  createSourceSearchWorkflow,
  type SourceSearchParams,
} from "@/lib/source-search-workflow";
import { createProductionStationDiscovery } from "@/lib/stations/station-discovery-adapters";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { getYouTubeClient } from "@/lib/youtube";

const externalPlatformSearchWorkflow = createExternalPlatformSearchWorkflow({
  adapters: {
    bandcamp: {
      search: searchBandcamp,
    },
    mixcloud: {
      search: searchMixcloud,
    },
    radiogarden: {
      search: searchRadioGarden,
    },
    soundcloud: {
      search: searchSoundCloud,
    },
    youtube: {
      search: async (query, filter) =>
        await getYouTubeClient().search(query, filter),
    },
  },
  reportProviderError: (provider, error) => {
    captureError(error, {
      operation: "searchPlatforms",
      surface: "ui",
      tags: { searchPlatform: provider },
    });
  },
});

const sourceSearch = createSourceSearchWorkflow({
  createDiscovery: (platform) =>
    createProductionStationDiscovery({
      radioBrowser: platform === "all" || platform === "radio-browser",
      radioGarden: platform === "all" || platform === "radiogarden",
    }),
  searchPlatform: externalPlatformSearchWorkflow.search,
});

export function useExternalSearch() {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const { reset: resetMutation, ...mutation } = useMutation({
    mutationFn: async (params: SourceSearchParams) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      return await sourceSearch.search(
        {
          ...params,
          knownStations: [...(params.knownStations ?? []), ...curatedRadios],
          playbackNeedsNetwork: Object.values(
            playbackRuntimeStore.state.channels
          ).some((channel) => channel.isLoading || channel.isBuffering),
        },
        controller.signal
      );
    },
  });
  // Stable identity is required by SearchInput’s context reset effect.
  const reset = useCallback(() => {
    active.current?.abort();
    resetMutation();
  }, [resetMutation]);
  return { ...mutation, reset };
}
