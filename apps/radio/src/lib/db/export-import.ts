import LZString from "lz-string";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  getSettings,
  radiosCollection,
  sessionRadiosCollection,
  settingsCollection,
} from "@/lib/collections";
import {
  buildNodeGraphFromMultipleRecord,
  createKeptRadioTest,
} from "@/lib/collections/migrations/multiple-to-node";
import {
  playbackSessionsCollection,
  writeNodeSessionGraph,
} from "@/lib/collections/playback-sessions";
import { commitNodeGraph, nodeStore } from "@/lib/node-graph/node-store";
import { migrateNodeGraph, type NodeGraph } from "@/lib/node-graph/schema";
import { type Issue, validate } from "@/lib/node-graph/validate";
import {
  normalizePlayerMode,
  type PlayerMode,
} from "@/lib/normalize-player-mode";
import { type DatabaseExport, generateId, type ImportPreview } from "../types";

const EXPORT_VERSION = 2;
const STORAGE_KEY_LAST_EXPORT = "radioproxy_last_export";
const DATA_FRAGMENT_LENGTH = 6;
const SETTINGS_ID = "app-settings";

type ImportedPlayerSettings = {
  mode?: PlayerMode;
  restoreStateOnLoad?: DatabaseExport["settings"]["player"]["restoreStateOnLoad"];
};

function normalizeImportedSettings(
  settings: DatabaseExport["settings"] | undefined
): ImportedPlayerSettings {
  const importedPlayer = settings?.player;
  // Backups from before Node say "multiple"; an unknown mode becomes Single.
  const mode: unknown = importedPlayer?.mode;
  return {
    mode:
      mode === undefined || mode === null
        ? undefined
        : normalizePlayerMode(mode),
    restoreStateOnLoad: importedPlayer?.restoreStateOnLoad,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A budget depends on the device and is enforced by the compiler, which
 * reports the Stations past it. The app itself saves such patches (Start from
 * Multiple over many stations, the search bar adding one more), so a backup
 * of one must import.
 */
function isBudgetIssue(issue: Issue): boolean {
  return issue.code.startsWith("budget-");
}

/**
 * Parses a Node patch through the same gate as a stored one: Zod, then
 * `migrateNodeGraph`, then `validate()`. Any problem but a budget throws.
 */
function parseImportedNodeGraph(raw: unknown): NodeGraph {
  const migration = migrateNodeGraph(raw);
  if (migration.status === "read-only") {
    throw new Error("Incompatible patch - it is from a newer version");
  }
  if (migration.status === "invalid") {
    throw new Error(`Invalid patch: ${migration.error}`);
  }
  const issue = validate(migration.graph).find(
    (candidate) => !isBudgetIssue(candidate)
  );
  if (issue) {
    throw new Error(`Invalid patch: ${issue.message}`);
  }
  return migration.graph;
}

/**
 * The Node patch a backup carries, or null when it carries none. A Multiple
 * session converts the way the Multiple → Node migration converts a stored
 * one, keeping stations the backup or this library saved, and session
 * stations still in this tab. Throws on anything invalid, so an import fails
 * closed before it changes anything.
 */
function readImportedNodePatch(importData: DatabaseExport): NodeGraph | null {
  const sessions: unknown = importData.sessions;
  if (sessions === undefined) {
    return null;
  }
  if (!isRecord(sessions)) {
    throw new Error("Invalid sessions data");
  }
  if (sessions.node !== undefined) {
    return parseImportedNodeGraph(
      isRecord(sessions.node) ? sessions.node.graph : undefined
    );
  }
  const { multiple } = sessions;
  if (multiple === undefined) {
    return null;
  }
  if (!(isRecord(multiple) && Array.isArray(multiple.channels))) {
    throw new Error("Invalid Multiple session");
  }
  // Through the same gate, so a snapshot the session schema rejects fails
  // here, before any change, and not halfway through the import.
  return parseImportedNodeGraph(
    buildNodeGraphFromMultipleRecord(
      multiple,
      createKeptRadioTest(
        [...importData.radios, ...radiosCollection.state.values()],
        sessionRadiosCollection.state.values()
      )
    )
  );
}

/**
 * Writes an imported patch to the node session, and into the open patch as
 * an undo step, so a running Node mode plays it instead of writing its old
 * patch back on the next edit.
 */
function applyImportedNodePatch(graph: NodeGraph | null): void {
  if (!graph) {
    return;
  }
  const written = writeNodeSessionGraph(graph);
  commitNodeGraph(() => written, nodeStore, "snapshot");
}

/** The Node patch for a file backup, when the node session holds one. */
function exportSessions(): DatabaseExport["sessions"] {
  const graph = playbackSessionsCollection.state.get("node")?.graph;
  return graph ? { node: { graph } } : undefined;
}

/**
 * The file backup: stations, settings and the Node patch. A share link
 * leaves the patch out.
 */
export const createDatabaseExport = (): DatabaseExport => {
  const radios = Array.from(radiosCollection.state.values());
  const settings = getSettings();

  return {
    exportDate: new Date().toISOString(),
    radios: radios as unknown as Radio[],
    sessions: exportSessions(),
    settings: (settings || {
      id: SETTINGS_ID,
      player: { mode: "single" },
    }) as unknown as DatabaseExport["settings"],
    version: EXPORT_VERSION,
  };
};

/**
 * Export the entire database to a JSON file
 */
export const exportDatabase = (): void => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error("Export can only be used in browser environment");
  }

  try {
    const jsonString = JSON.stringify(createDatabaseExport(), null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `radioproxy-config-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Store export timestamp
    localStorage.setItem(STORAGE_KEY_LAST_EXPORT, new Date().toISOString());
    toast.success("Backup downloaded");
  } catch (error) {
    console.error("Export failed:", error);
    toast.error("Couldn't download backup");
  }
};

/**
 * Generate a shareable URL with compressed data in the fragment
 */
export const generateShareUrl = (): string => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error(
      "Share URL generation can only be used in browser environment"
    );
  }

  try {
    const radios = Array.from(radiosCollection.state.values());
    const settings = getSettings();

    const exportData: DatabaseExport = {
      exportDate: new Date().toISOString(),
      radios: radios as unknown as Radio[],
      settings: (settings || {
        id: SETTINGS_ID,
        player: { mode: "single" },
      }) as unknown as DatabaseExport["settings"],
      version: EXPORT_VERSION,
    };

    const jsonString = JSON.stringify(exportData);
    // Use compressToBase64 directly - it handles both compression and base64 encoding
    const base64 = LZString.compressToBase64(jsonString);

    // Generate URL pointing to the import page
    const baseUrl = window.location.origin;
    const importUrl = new URL("/import", baseUrl);
    importUrl.hash = `#data=${encodeURIComponent(base64)}`;

    return importUrl.toString();
  } catch (error) {
    console.error("Share URL generation failed:", error);
    throw new Error("Failed to generate share URL", { cause: error });
  }
};

/**
 * Copy share URL to clipboard
 */
export const copyShareUrlToClipboard = async (): Promise<void> => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error(
      "Clipboard operations can only be used in browser environment"
    );
  }

  try {
    const shareUrl = generateShareUrl();
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Share link copied");
  } catch (error) {
    console.error("Copy to clipboard failed:", error);
    toast.error("Couldn't copy share link");
  }
};

/** Where import data comes from: a file backup, or a share link. */
type ImportSource = "backup" | "share-link";

/**
 * Parse import data from JSON string. A share link never carries a Node
 * patch (share-by-URL patches are later work, with their own stripping), so
 * one in a link is dropped unread rather than replacing the local patch.
 */
export const parseImportData = (
  dataString: string,
  source: ImportSource = "backup"
): DatabaseExport => {
  try {
    const data: unknown = JSON.parse(dataString);
    return validateImportData(
      source === "share-link" && isRecord(data)
        ? { ...data, sessions: undefined }
        : data
    );
  } catch (error) {
    throw new Error("Invalid JSON format", { cause: error });
  }
};

/**
 * Validate import data structure
 */
export const validateImportData = (data: unknown): DatabaseExport => {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid data format");
  }

  const exportData = data as Record<string, unknown>;

  if (typeof exportData.version !== "number") {
    throw new Error("Missing or invalid version");
  }

  if (exportData.version > EXPORT_VERSION) {
    throw new Error(
      "Incompatible version - this export is from a newer version"
    );
  }

  if (!Array.isArray(exportData.radios)) {
    throw new Error("Invalid radios data");
  }

  if (!exportData.settings || typeof exportData.settings !== "object") {
    throw new Error("Invalid settings data");
  }

  const importData: DatabaseExport = {
    ...(data as DatabaseExport),
    settings: {
      player: normalizeImportedSettings(
        exportData.settings as DatabaseExport["settings"]
      ),
    } as DatabaseExport["settings"],
  };
  // Refuse an invalid patch here, before any preview or change.
  readImportedNodePatch(importData);
  return importData;
};

/**
 * Extract and parse data from URL fragment
 */
export const importFromUrl = (url: string): DatabaseExport => {
  try {
    const urlObj = new URL(url);
    const fragment = urlObj.hash;

    if (!fragment.startsWith("#data=")) {
      throw new Error("Invalid share URL format");
    }

    const base64Data = decodeURIComponent(fragment.slice(DATA_FRAGMENT_LENGTH));
    // decompressFromBase64 returns the original string directly (not compressed data)
    const jsonString = LZString.decompressFromBase64(base64Data);

    if (!jsonString) {
      throw new Error("Failed to decompress data");
    }

    return parseImportData(jsonString, "share-link");
  } catch (error) {
    console.error("URL import failed:", error);
    throw new Error("Failed to import from URL", { cause: error });
  }
};

/**
 * Import data from file
 */
export const importFromFile = async (file: File): Promise<DatabaseExport> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result !== "string") {
          throw new Error("Failed to read file");
        }
        const data = parseImportData(result);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsText(file);
  });

/**
 * Preview what changes would be made during import
 */
export const previewImportChanges = (
  importData: DatabaseExport
): ImportPreview => {
  const existingRadios = Array.from(radiosCollection.state.values());
  const existingSettings = getSettings();

  const existingRadiosMap = new Map(
    existingRadios.map((radio) => [radio.name, radio])
  );

  let newRadios = 0;
  let updatedRadios = 0;
  let unchangedRadios = 0;

  for (const importedRadio of importData.radios) {
    const existing = existingRadiosMap.get(importedRadio.name);

    if (existing) {
      const importsMetadataConfig = importedRadio.metadataConfig !== undefined;
      const importsStreamFormat = importedRadio.streamFormat !== undefined;
      const hasChanged =
        existing.streamUrl !== importedRadio.streamUrl ||
        (importsStreamFormat &&
          existing.streamFormat !== importedRadio.streamFormat) ||
        existing.logoUrl !== importedRadio.logoUrl ||
        existing.description !== importedRadio.description ||
        existing.websiteUrl !== importedRadio.websiteUrl ||
        (importsMetadataConfig &&
          JSON.stringify(existing.metadataConfig) !==
            JSON.stringify(importedRadio.metadataConfig));

      if (hasChanged) {
        updatedRadios += 1;
      } else {
        unchangedRadios += 1;
      }
    } else {
      newRadios += 1;
    }
  }

  const settingsChanged =
    existingSettings !== undefined &&
    JSON.stringify(existingSettings) !== JSON.stringify(importData.settings);

  return {
    newRadios,
    settingsChanged,
    unchangedRadios,
    updatedRadios,
  };
};

/**
 * Replace all data with imported data
 */
export const replaceImportedData = (importData: DatabaseExport): void => {
  try {
    applyImportedNodePatch(readImportedNodePatch(importData));

    // Clear existing radios
    const existingRadios = Array.from(radiosCollection.state.values());
    for (const radio of existingRadios) {
      radiosCollection.delete(radio.id);
    }

    // Import new radios
    for (const radio of importData.radios) {
      const id = radio.id ? String(radio.id) : generateId();
      radiosCollection.insert({
        description: radio.description,
        enabled: radio.enabled ?? true,
        id,
        logoUrl: radio.logoUrl,
        metadataConfig: radio.metadataConfig,
        name: radio.name,
        order: radio.order ?? 0,
        platformMetadata: radio.platformMetadata,
        streamFormat: radio.streamFormat,
        streamUrl: radio.streamUrl,
        websiteUrl: radio.websiteUrl,
      });
    }

    // Replace settings
    const existingSettings = getSettings();
    const importPlayer = normalizeImportedSettings(importData.settings);
    if (existingSettings) {
      settingsCollection.update(SETTINGS_ID, (draft) => {
        draft.player.mode = normalizePlayerMode(
          importPlayer.mode ?? existingSettings.player.mode
        );
        draft.player.restoreStateOnLoad =
          importPlayer.restoreStateOnLoad ??
          existingSettings.player.restoreStateOnLoad;
      });
    } else {
      settingsCollection.insert({
        id: SETTINGS_ID,
        player: {
          mode: importPlayer.mode ?? "single",
          restoreStateOnLoad: importPlayer.restoreStateOnLoad ?? true,
        },
      });
    }

    toast.success(`Imported ${importData.radios.length} stations`);
  } catch (error) {
    console.error("Replace import failed:", error);
    toast.error("Couldn't import");
    throw error;
  }
};

/**
 * Merge imported data with existing data
 */
export const mergeImportedData = (importData: DatabaseExport): void => {
  try {
    applyImportedNodePatch(readImportedNodePatch(importData));

    const existingRadios = Array.from(radiosCollection.state.values());
    const existingSettings = getSettings();

    // Merge radios using similar logic to syncRadioData
    const existingRadiosMap = new Map(
      existingRadios.map((radio) => [radio.name, radio])
    );

    let newRadiosCount = 0;
    let updatedRadiosCount = 0;

    for (const importedRadio of importData.radios) {
      const existing = existingRadiosMap.get(importedRadio.name);

      if (existing) {
        // Check if radio data has changed
        const importsMetadataConfig =
          importedRadio.metadataConfig !== undefined;
        const importsStreamFormat = importedRadio.streamFormat !== undefined;
        const hasChanged =
          existing.streamUrl !== importedRadio.streamUrl ||
          (importsStreamFormat &&
            existing.streamFormat !== importedRadio.streamFormat) ||
          existing.logoUrl !== importedRadio.logoUrl ||
          existing.description !== importedRadio.description ||
          existing.websiteUrl !== importedRadio.websiteUrl ||
          (importsMetadataConfig &&
            JSON.stringify(existing.metadataConfig) !==
              JSON.stringify(importedRadio.metadataConfig));

        if (hasChanged) {
          // Update existing radio with new data, preserving user preferences
          radiosCollection.update(existing.id, (draft) => {
            draft.streamUrl = importedRadio.streamUrl;
            if (importsStreamFormat) {
              draft.streamFormat = importedRadio.streamFormat;
            }
            draft.logoUrl = importedRadio.logoUrl;
            draft.description = importedRadio.description;
            draft.websiteUrl = importedRadio.websiteUrl;
            if (importsMetadataConfig) {
              draft.metadataConfig = importedRadio.metadataConfig;
            }
            // Keep order and enabled status from existing
          });
          updatedRadiosCount += 1;
        }
      } else {
        // New radio - add with disabled state
        const maxOrder = Math.max(
          ...existingRadios.map((r) => r.order || 0),
          0
        );
        radiosCollection.insert({
          description: importedRadio.description,
          enabled: false, // New radios are disabled by default
          id: generateId(),
          logoUrl: importedRadio.logoUrl,
          metadataConfig: importedRadio.metadataConfig,
          name: importedRadio.name,
          order: maxOrder + newRadiosCount + 1,
          streamFormat: importedRadio.streamFormat,
          streamUrl: importedRadio.streamUrl,
          websiteUrl: importedRadio.websiteUrl,
        });
        newRadiosCount += 1;
      }
    }

    // Merge settings (be careful not to overwrite volatile data)
    if (existingSettings) {
      const importPlayer = normalizeImportedSettings(importData.settings);
      settingsCollection.update(SETTINGS_ID, (draft) => {
        // Merge player settings; a stored legacy mode is normalised too
        draft.player.mode = normalizePlayerMode(
          importPlayer.mode ?? draft.player.mode
        );
        if (importPlayer.restoreStateOnLoad !== undefined) {
          draft.player.restoreStateOnLoad = importPlayer.restoreStateOnLoad;
        }
      });
    } else {
      const importPlayer = normalizeImportedSettings(importData.settings);
      settingsCollection.insert({
        id: SETTINGS_ID,
        player: {
          mode: importPlayer.mode ?? "single",
          restoreStateOnLoad: importPlayer.restoreStateOnLoad ?? true,
        },
      });
    }

    toast.success(
      `Imported ${newRadiosCount} new (hidden), ${updatedRadiosCount} updated`
    );
  } catch (error) {
    console.error("Merge import failed:", error);
    toast.error("Couldn't import");
    throw error;
  }
};

/**
 * Get the last export date from localStorage
 */
export const getLastExportDate = (): string | null => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEY_LAST_EXPORT);
};

/**
 * Check if URL contains import data
 */
export const hasImportDataInUrl = (): boolean => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.hash.startsWith("#data=");
};

/**
 * Auto-import from URL on page load
 */
export const autoImportFromUrl = (): DatabaseExport | null => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    return null;
  }

  if (!hasImportDataInUrl()) {
    return null;
  }

  try {
    const importedData = importFromUrl(window.location.href);

    // Clear the URL fragment after successful import
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState({}, "", url.toString());

    return importedData;
  } catch (error) {
    console.error("Auto-import from URL failed:", error);
    toast.error("Couldn't read share link");
    return null;
  }
};
