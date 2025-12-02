import type { Radio } from "@avoid.quest/radio-shared";

export type {
  Radio,
  RadioMetadata,
  ScrapedOption,
} from "@avoid.quest/radio-shared";

export type Settings = {
  id?: number;
  player: {
    mode: (typeof playerModes)[number]["value"];
    playerType?: (typeof playerTypes)[number]["value"];
    single?: {
      lastUsedRadio?: Radio;
      transitionDuration: number;
    };
  };
};

export type SingleModeSettings = Settings & {
  player: Settings["player"] & {
    mode: "single";
    single: {
      lastUsedRadio?: Radio;
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
