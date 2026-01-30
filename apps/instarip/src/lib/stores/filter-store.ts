import { Store } from "@tanstack/react-store";

export type DatePreset = "all" | "week" | "month" | "year" | "custom";

export type FilterState = {
  /** Search query for caption text */
  search: string;
  /** User ID filter */
  userId: string | null;
  /** Date range preset */
  datePreset: DatePreset;
  /** Custom start date (timestamp in ms) */
  startDate: number | null;
  /** Custom end date (timestamp in ms) */
  endDate: number | null;
};

const initialState: FilterState = {
  search: "",
  userId: null,
  datePreset: "all",
  startDate: null,
  endDate: null,
};

export const filterStore = new Store<FilterState>(initialState);

export function setSearch(search: string) {
  filterStore.setState((state) => ({ ...state, search }));
}

export function setUserId(userId: string | null) {
  filterStore.setState((state) => ({ ...state, userId }));
}

export function setDatePreset(preset: DatePreset) {
  const now = Date.now();
  let startDate: number | null = null;
  let endDate: number | null = null;

  switch (preset) {
    case "week":
      startDate = now - 7 * 24 * 60 * 60 * 1000;
      endDate = now;
      break;
    case "month":
      startDate = now - 30 * 24 * 60 * 60 * 1000;
      endDate = now;
      break;
    case "year":
      startDate = now - 365 * 24 * 60 * 60 * 1000;
      endDate = now;
      break;
    case "custom":
      // Keep existing dates for custom
      return filterStore.setState((state) => ({
        ...state,
        datePreset: preset,
      }));
    default:
      // "all" or any other - clear dates
      break;
  }

  filterStore.setState((state) => ({
    ...state,
    datePreset: preset,
    startDate,
    endDate,
  }));
}

export function setCustomDateRange(
  startDate: number | null,
  endDate: number | null
) {
  filterStore.setState((state) => ({
    ...state,
    datePreset: "custom",
    startDate,
    endDate,
  }));
}

export function clearFilters() {
  filterStore.setState(() => initialState);
}

export function hasActiveFilters(state: FilterState): boolean {
  return (
    state.search !== "" || state.userId !== null || state.datePreset !== "all"
  );
}
