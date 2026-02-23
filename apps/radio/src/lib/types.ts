// biome-ignore lint/style/noExportedImports: needed for local use and re-export
import type { Radio } from "@/lib/audio";

// Re-export Radio type for use in app
export type { Radio };

export type Settings = {
  id?: number;
  player: {
    mode: (typeof playerModes)[number]["value"];
    playerType?: (typeof playerTypes)[number]["value"];
    restoreStateOnLoad?: boolean;
    single?: {
      transitionDuration: number;
    };
  };
};

export type SingleModeSettings = Settings & {
  player: Settings["player"] & {
    mode: "single";
    single: {
      transitionDuration: number;
    };
  };
};

export const playerModes = [
  { value: "single", label: "Single", icon: "list-music" },
  { value: "multiple", label: "Multiple", icon: "square-stack" },
  { value: "dj", label: "DJ", icon: "swords" },
] as const;
export const playerTypes = [
  { value: "default", label: "Custom Player" },
  { value: "browser", label: "Browser Default" },
] as const;

export type DatabaseExport = {
  version: number;
  exportDate: string;
  radios: Radio[];
  settings: Settings;
};

export type ImportMode = "replace" | "merge";

/**
 * Generate a unique ID, with fallback for environments where crypto.randomUUID
 * is unavailable (e.g. Safari iOS < 15.4, non-secure contexts).
 */
export function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}-${Math.random().toString(36).slice(2, 9)}`;
}

export type ImportPreview = {
  newRadios: number;
  updatedRadios: number;
  unchangedRadios: number;
  settingsChanged: boolean;
};
