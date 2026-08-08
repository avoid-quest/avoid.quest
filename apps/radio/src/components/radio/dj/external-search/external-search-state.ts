import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";

export type ExternalSearchState = {
  error: string | null;
  platform: SearchPlatform;
  results: UnifiedSearchResult[];
};

export type ExternalSearchStateAction =
  | { initialPlatform?: SearchPlatform; type: "reset" }
  | { error: string; type: "error" }
  | { platform: SearchPlatform; type: "platform" }
  | { results: UnifiedSearchResult[]; type: "results" }
  | { type: "clear" };

export function createExternalSearchState(
  initialPlatform?: SearchPlatform
): ExternalSearchState {
  return {
    error: null,
    platform: initialPlatform ?? "all",
    results: [],
  };
}

export function reduceExternalSearchState(
  state: ExternalSearchState,
  action: ExternalSearchStateAction
): ExternalSearchState {
  switch (action.type) {
    case "clear":
      return { ...state, error: null, results: [] };
    case "error":
      return { ...state, error: action.error, results: [] };
    case "platform":
      return { error: null, platform: action.platform, results: [] };
    case "reset":
      return createExternalSearchState(action.initialPlatform);
    case "results":
      return { ...state, error: null, results: action.results };
    default:
      return state;
  }
}
