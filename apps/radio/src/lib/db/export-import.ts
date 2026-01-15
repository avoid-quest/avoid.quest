import LZString from "lz-string";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import type { DatabaseExport, ImportPreview } from "../types";
import { db } from ".";

const EXPORT_VERSION = 1;
const STORAGE_KEY_LAST_EXPORT = "radioproxy_last_export";
const DATA_FRAGMENT_LENGTH = 6;

/**
 * Export the entire database to a JSON file
 */
export const exportDatabase = async (): Promise<void> => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error("Export can only be used in browser environment");
  }

  try {
    const [radios, settings] = await Promise.all([
      db.radios.toArray(),
      db.settings.toArray(),
    ]);

    const exportData: DatabaseExport = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      radios,
      settings: settings[0] || { player: { mode: "multiple" } },
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
export const generateShareUrl = async (): Promise<string> => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error(
      "Share URL generation can only be used in browser environment"
    );
  }

  try {
    const [radios, settings] = await Promise.all([
      db.radios.toArray(),
      db.settings.toArray(),
    ]);

    const exportData: DatabaseExport = {
      version: EXPORT_VERSION,
      exportDate: new Date().toISOString(),
      radios,
      settings: settings[0] || { player: { mode: "multiple" } },
    };

    const jsonString = JSON.stringify(exportData);
    const compressed = LZString.compress(jsonString);
    const base64 = LZString.compressToBase64(compressed);

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
    const shareUrl = await generateShareUrl();
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

  return data as DatabaseExport;
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
    const compressed = LZString.decompressFromBase64(base64Data);

    if (!compressed) {
      throw new Error("Failed to decompress data");
    }

    const jsonString = LZString.decompress(compressed);

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
export const previewImportChanges = async (
  importData: DatabaseExport
): Promise<ImportPreview> => {
  const existingRadios = await db.radios.toArray();
  const existingSettings = await db.settings.limit(1).toArray();

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
    existingSettings.length > 0 &&
    JSON.stringify(existingSettings[0]) !== JSON.stringify(importData.settings);

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
export const replaceImportedData = async (
  importData: DatabaseExport
): Promise<void> => {
  try {
    // Clear existing data
    await db.radios.clear();
    await db.settings.clear();

    // Import new data
    if (importData.radios.length > 0) {
      await db.radios.bulkAdd(importData.radios);
    }

    if (importData.settings) {
      await db.settings.add(importData.settings);
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
export const mergeImportedData = async (
  importData: DatabaseExport
): Promise<void> => {
  try {
    const existingRadios = await db.radios.toArray();
    const existingSettings = await db.settings.limit(1).toArray();

    // Merge radios using similar logic to syncRadioData
    const existingRadiosMap = new Map(
      existingRadios.map((radio) => [radio.name, radio])
    );

    const newRadios: Radio[] = [];
    const updatedRadios: Radio[] = [];

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
          updatedRadios.push({
            ...importedRadio,
            id: existing.id, // Keep the existing ID
            order: existing.order, // Preserve user's custom order
            enabled: existing.enabled, // Preserve user's enabled/disabled state
          });
        }
      } else {
        // New radio - add to newRadios
        const maxOrder = Math.max(
          ...existingRadios.map((r) => r.order || 0),
          0
        );
        newRadios.push({
          ...importedRadio,
          order: maxOrder + newRadios.length + 1,
          enabled: false, // New radios are disabled by default
        });
      }
    }

    // Apply changes
    if (newRadios.length > 0) {
      await db.radios.bulkAdd(newRadios);
    }

    if (updatedRadios.length > 0) {
      await db.radios.bulkPut(updatedRadios);
    }

    // Merge settings (be careful not to overwrite volatile data)
    if (importData.settings && existingSettings.length > 0) {
      const currentSettings = existingSettings[0];
      if (currentSettings) {
        const mergedSettings = {
          ...importData.settings,
          id: currentSettings.id, // Keep existing ID
          player: {
            ...importData.settings.player,
            // Preserve volatile single mode data
            single:
              currentSettings.player.single ||
              importData.settings.player.single,
          },
        };
        await db.settings.update(currentSettings.id, mergedSettings);
      }
    } else if (importData.settings) {
      await db.settings.add(importData.settings);
    }

    toast.success(
      `Configuration merged successfully: ${newRadios.length} new, ${updatedRadios.length} updated`
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
    const importData = importFromUrl(window.location.href);

    // Clear the URL fragment after successful import
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState({}, "", url.toString());

    return importData;
  } catch (error) {
    console.error("Auto-import from URL failed:", error);
    toast.error("Failed to import configuration from URL");
    return null;
  }
};
