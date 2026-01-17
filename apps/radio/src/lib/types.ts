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
  { value: "multiple", label: "Multiple", icon: "square-stack" },
  { value: "single", label: "Single", icon: "list-music" },
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

export type ImportPreview = {
  newRadios: number;
  updatedRadios: number;
  unchangedRadios: number;
  settingsChanged: boolean;
};
