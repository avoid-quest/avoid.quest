import LZString from "lz-string";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  getSettings,
  radiosCollection,
  type SettingsRecord,
  settingsCollection,
} from "@/lib/collections";
import { type DatabaseExport, generateId, type ImportPreview } from "../types";

const EXPORT_VERSION = 2;
const STORAGE_KEY_LAST_EXPORT = "radioproxy_last_export";
const DATA_FRAGMENT_LENGTH = 6;
const SETTINGS_ID = "app-settings";

type ImportedPlayerSettings = {
  mode?: DatabaseExport["settings"]["player"]["mode"];
  restoreStateOnLoad?: DatabaseExport["settings"]["player"]["restoreStateOnLoad"];
  single?: DatabaseExport["settings"]["player"]["single"];
};

function normalizeImportedSettings(
  settings: DatabaseExport["settings"] | SettingsRecord | undefined
): ImportedPlayerSettings {
  const importedPlayer = settings?.player;
  return {
    mode: importedPlayer?.mode,
    restoreStateOnLoad: importedPlayer?.restoreStateOnLoad,
    single: importedPlayer?.single,
  };
}

/**
 * Export the entire database to a JSON file
 */
export const exportDatabase = (): void => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error("Export can only be used in browser environment");
  }

  try {
    const radios = Array.from(radiosCollection.state.values());
    const settings = getSettings();

    const exportData: DatabaseExport = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      radios: radios as unknown as Radio[],
      settings: (settings || {
        id: SETTINGS_ID,
        player: { mode: "single" },
      }) as unknown as DatabaseExport["settings"],
    };

    const jsonString = JSON.stringify(exportData, null, 2);
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
    toast.success("Configuration exported successfully");
  } catch (error) {
    console.error("Export failed:", error);
    toast.error("Failed to export configuration");
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
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      radios: radios as unknown as Radio[],
      settings: (settings || {
        id: SETTINGS_ID,
        player: { mode: "single" },
      }) as unknown as DatabaseExport["settings"],
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
    throw new Error("Failed to generate share URL");
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
    toast.success("Share link copied to clipboard");
  } catch (error) {
    console.error("Copy to clipboard failed:", error);
    toast.error("Failed to copy share link");
  }
};

/**
 * Parse import data from JSON string
 */
export const parseImportData = (dataString: string): DatabaseExport => {
  try {
    const data = JSON.parse(dataString);
    return validateImportData(data);
  } catch {
    throw new Error("Invalid JSON format");
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

  return {
    ...(data as DatabaseExport),
    settings: {
      player: normalizeImportedSettings(
        exportData.settings as DatabaseExport["settings"]
      ),
    } as DatabaseExport["settings"],
  };
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

    const base64Data = decodeURIComponent(
      fragment.substring(DATA_FRAGMENT_LENGTH)
    );
    // decompressFromBase64 returns the original string directly (not compressed data)
    const jsonString = LZString.decompressFromBase64(base64Data);

    if (!jsonString) {
      throw new Error("Failed to decompress data");
    }

    return parseImportData(jsonString);
  } catch (error) {
    console.error("URL import failed:", error);
    throw new Error("Failed to import from URL");
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
      const hasChanged =
        existing.streamUrl !== importedRadio.streamUrl ||
        existing.logoUrl !== importedRadio.logoUrl ||
        existing.description !== importedRadio.description ||
        existing.websiteUrl !== importedRadio.websiteUrl;

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
    updatedRadios,
    unchangedRadios,
    settingsChanged,
  };
};

/**
 * Replace all data with imported data
 */
export const replaceImportedData = (importData: DatabaseExport): void => {
  try {
    // Clear existing radios
    const existingRadios = Array.from(radiosCollection.state.values());
    for (const radio of existingRadios) {
      radiosCollection.delete(radio.id);
    }

    // Import new radios
    for (const radio of importData.radios) {
      const id = radio.id ? String(radio.id) : generateId();
      radiosCollection.insert({
        id,
        name: radio.name,
        streamUrl: radio.streamUrl,
        logoUrl: radio.logoUrl,
        description: radio.description,
        websiteUrl: radio.websiteUrl,
        order: radio.order ?? 0,
        enabled: radio.enabled ?? true,
        platformMetadata: radio.platformMetadata,
      });
    }

    // Replace settings
    if (importData.settings) {
      const existingSettings = getSettings();
      const importPlayer = normalizeImportedSettings(importData.settings);
      if (existingSettings) {
        settingsCollection.update(SETTINGS_ID, (draft) => {
          draft.player.mode = importPlayer.mode ?? existingSettings.player.mode;
          draft.player.restoreStateOnLoad =
            importPlayer.restoreStateOnLoad ??
            existingSettings.player.restoreStateOnLoad;
          if (importPlayer.single) {
            draft.player.single = importPlayer.single;
          }
        });
      } else {
        settingsCollection.insert({
          id: SETTINGS_ID,
          player: {
            mode: importPlayer.mode ?? "single",
            restoreStateOnLoad: importPlayer.restoreStateOnLoad ?? true,
            single: importPlayer.single,
          },
        });
      }
    }

    toast.success(
      `Configuration imported successfully: ${importData.radios.length} radios, settings updated`
    );
  } catch (error) {
    console.error("Replace import failed:", error);
    toast.error("Failed to import configuration");
    throw error;
  }
};

/**
 * Merge imported data with existing data
 */
export const mergeImportedData = (importData: DatabaseExport): void => {
  try {
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
        const hasChanged =
          existing.streamUrl !== importedRadio.streamUrl ||
          existing.logoUrl !== importedRadio.logoUrl ||
          existing.description !== importedRadio.description ||
          existing.websiteUrl !== importedRadio.websiteUrl;

        if (hasChanged) {
          // Update existing radio with new data, preserving user preferences
          radiosCollection.update(existing.id, (draft) => {
            draft.streamUrl = importedRadio.streamUrl;
            draft.logoUrl = importedRadio.logoUrl;
            draft.description = importedRadio.description;
            draft.websiteUrl = importedRadio.websiteUrl;
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
          id: generateId(),
          name: importedRadio.name,
          streamUrl: importedRadio.streamUrl,
          logoUrl: importedRadio.logoUrl,
          description: importedRadio.description,
          websiteUrl: importedRadio.websiteUrl,
          order: maxOrder + newRadiosCount + 1,
          enabled: false, // New radios are disabled by default
        });
        newRadiosCount += 1;
      }
    }

    // Merge settings (be careful not to overwrite volatile data)
    if (importData.settings && existingSettings) {
      const importPlayer = normalizeImportedSettings(importData.settings);
      settingsCollection.update(SETTINGS_ID, (draft) => {
        // Merge player settings
        if (importPlayer.mode) {
          draft.player.mode = importPlayer.mode;
        }
        if (importPlayer.restoreStateOnLoad !== undefined) {
          draft.player.restoreStateOnLoad = importPlayer.restoreStateOnLoad;
        }
        if (!draft.player.single && importPlayer.single) {
          draft.player.single = importPlayer.single;
        }
      });
    } else if (importData.settings) {
      const importPlayer = normalizeImportedSettings(importData.settings);
      settingsCollection.insert({
        id: SETTINGS_ID,
        player: {
          mode: importPlayer.mode ?? "single",
          restoreStateOnLoad: importPlayer.restoreStateOnLoad ?? true,
          single: importPlayer.single,
        },
      });
    }

    toast.success(
      `Configuration merged successfully: ${newRadiosCount} new, ${updatedRadiosCount} updated`
    );
  } catch (error) {
    console.error("Merge import failed:", error);
    toast.error("Failed to merge configuration");
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
    toast.error("Failed to import configuration from URL");
    return null;
  }
};
