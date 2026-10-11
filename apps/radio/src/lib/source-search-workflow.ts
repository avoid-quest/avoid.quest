import type {
  ExternalPlatformSearchParams,
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import type { Radio } from "@/lib/audio";
import type {
  StationDiscovery,
  StationDiscoveryResult,
} from "@/lib/stations/station-discovery";

export type SourceSearchPlatform = SearchPlatform | "radio-browser" | "local";
export type SourceSearchResult = Omit<UnifiedSearchResult, "platform"> & {
  platform: Exclude<SourceSearchPlatform, "all">;
  /** Directory results have already passed station intake and audio probing. */
  radio?: Radio;
};
export type SourceSearchParams = Omit<
  ExternalPlatformSearchParams,
  "platform"
> & {
  platform: SourceSearchPlatform;
  knownStations?: readonly Radio[];
  onProgress?: (results: SourceSearchResult[]) => void;
  playbackNeedsNetwork?: boolean;
};
const TRACK_PROVIDERS = [
  "bandcamp",
  "mixcloud",
  "soundcloud",
  "youtube",
] as const;

function stationResult(result: StationDiscoveryResult): SourceSearchResult {
  return {
    artist: [result.location, result.country].filter(Boolean).join(", "),
    id: result.key,
    platform:
      result.action.type === "radio-garden"
        ? "radiogarden"
        : result.action.type,
    radio: result.action.radio,
    thumbnail: result.logoUrl,
    title: result.name,
    type: "station",
    url: result.action.radio.streamUrl,
  };
}

/** One search session owns platform fan-out and the existing verified station discovery. */
export function createSourceSearchWorkflow({
  searchPlatform,
  createDiscovery,
}: {
  searchPlatform: (
    params: ExternalPlatformSearchParams
  ) => Promise<UnifiedSearchResult[]>;
  createDiscovery: (platform: SourceSearchPlatform) => StationDiscovery;
}) {
  return {
    async search(
      params: SourceSearchParams,
      signal: AbortSignal
    ): Promise<SourceSearchResult[]> {
      signal.throwIfAborted();
      const groups = new Map<string, SourceSearchResult[]>();
      const snapshot = () => {
        const lists = [...groups.values()];
        return Array.from(
          { length: Math.max(0, ...lists.map((list) => list.length)) },
          (_, index) =>
            lists.flatMap((list) => (list[index] ? [list[index]] : []))
        ).flat();
      };
      const publish = (provider: string, results: SourceSearchResult[]) => {
        if (signal.aborted) {
          return;
        }
        groups.set(provider, results);
        params.onProgress?.(snapshot());
      };
      const providers =
        params.platform === "all"
          ? TRACK_PROVIDERS
          : TRACK_PROVIDERS.filter((provider) => provider === params.platform);
      let failures = 0;
      const pending = providers.map(async (platform) => {
        groups.set(platform, []);
        try {
          publish(
            platform,
            await searchPlatform({
              ...params,
              bandcampFilter: params.bandcampFilter ?? "t",
              platform,
            })
          );
        } catch (error) {
          failures += 1;
          if (params.platform !== "all") {
            throw error;
          }
        }
      });
      if (
        ["all", "local", "radiogarden", "radio-browser"].includes(
          params.platform
        )
      ) {
        groups.set("stations", []);
        pending.push(
          new Promise<void>((resolve, reject) => {
            const discovery = createDiscovery(params.platform);
            let cancel: () => void = () => undefined;
            const abort = () => {
              cancel();
              reject(signal.reason);
            };
            signal.addEventListener("abort", abort, { once: true });
            cancel = discovery.search(
              {
                knownStations:
                  params.platform === "all" || params.platform === "local"
                    ? (params.knownStations ?? [])
                    : [],
                playbackNeedsNetwork: params.playbackNeedsNetwork,
                query: params.query,
              },
              (state) => {
                publish("stations", state.results.map(stationResult));
                if (!state.isSearching) {
                  signal.removeEventListener("abort", abort);
                  resolve();
                }
              }
            );
          })
        );
      }
      await Promise.all(pending);
      signal.throwIfAborted();
      if (failures === TRACK_PROVIDERS.length && snapshot().length === 0) {
        throw new Error("Search is unavailable. Try again or paste a link.");
      }
      return snapshot();
    },
  };
}
