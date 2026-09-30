// biome-ignore lint/style/noExportedImports: needed for local use and re-export
import type { Radio } from "@/lib/audio";

// Re-export Radio type for use in app
export type { Radio };

export type Settings = {
  id?: number;
  player: {
    mode: (typeof playerModes)[number]["value"];
    restoreStateOnLoad?: boolean;
  };
};

export type SingleModeSettings = Settings & {
  player: Settings["player"] & {
    mode: "single";
  };
};

export const playerModes = [
  { icon: "list-music", label: "Single", value: "single" },
  { icon: "cable", label: "Node", value: "node" },
  { icon: "swords", label: "DJ", value: "dj" },
] as const;

export type DatabaseExport = {
  version: number;
  exportDate: string;
  radios: Radio[];
  settings: Settings;
  /** Local NAM bytes referenced by the file backup's Node patch. */
  namModels?: Record<string, string>;
  /**
   * Playback sessions a file backup carries: the Node patch, or a Multiple
   * session from a release before Node, which imports as a Node patch. Both
   * stay untrusted until the import parses them.
   */
  sessions?: {
    node?: { graph: unknown };
    multiple?: unknown;
  };
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
