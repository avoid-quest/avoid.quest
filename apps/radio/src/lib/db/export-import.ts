import { createTransaction } from "@tanstack/react-db";
import LZString from "lz-string";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  getSettings,
  type RadioRecord,
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
  prepareNodeSessionGraph,
  writeNodeSessionGraph,
} from "@/lib/collections/playback-sessions";
import {
  commitNodeGraph,
  loadNodeGraph,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { migrateNodeGraph, type NodeGraph } from "@/lib/node-graph/schema";
import { type Issue, validate } from "@/lib/node-graph/validate";
import {
  normalizePlayerMode,
  type PlayerMode,
} from "@/lib/normalize-player-mode";
import { type DatabaseExport, generateId, type ImportPreview } from "../types";
import {
  exportNamModels,
  hasLocalNamModels,
  prepareImportedNamModels,
  validateMissingNamModels,
  validateNamModelBackup,
} from "./nam-backup";

/** A backup with only stations and settings an older release can apply. */
const LIBRARY_EXPORT_VERSION = 2;
/**
 * A backup with Node data: a patch, its models, or the "node" mode. Releases
 * before Node refuse it as newer instead of half-applying it. This is also
 * the newest version this release imports.
 */
const EXPORT_VERSION = 3;
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
  if (importedPlayer !== undefined && !isRecord(importedPlayer)) {
    throw new Error("Invalid player settings");
  }
  // Backups from before Node say "multiple"; an unknown mode becomes Single.
  const mode: unknown = importedPlayer?.mode;
  // Validate the imported fields without filling omitted merge preferences.
  settingsCollection.validateData(
    {
      id: SETTINGS_ID,
      player: {
        mode:
          mode === undefined || mode === null
            ? undefined
            : normalizePlayerMode(mode),
        restoreStateOnLoad: importedPlayer?.restoreStateOnLoad,
      },
    },
    "insert"
  );
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

/** Graph-only backups omit the Speakers level, so imports default to 1. */
function readImportedMasterVolume(
  importData: DatabaseExport
): number | undefined {
  const session = importData.sessions?.node ?? importData.sessions?.multiple;
  if (session === undefined) {
    return undefined;
  }
  const value = isRecord(session) ? session.masterVolume : undefined;
  if (value === undefined) {
    return 1;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      "Invalid Node master volume: expected a number from 0 to 1"
    );
  }
  return value;
}

/**
 * A patch import stores its Speakers level in the session; while Node is the
 * mode, the running audio takes it too, as a change of the control would.
 * Otherwise Node's activation applies it.
 */
function applyImportedMasterVolume(): Promise<void> {
  if (normalizePlayerMode(getSettings()?.player.mode) !== "node") {
    return Promise.resolve();
  }
  return import("@/lib/playback-actions-shared")
    .then(({ applySessionMasterVolume }) => {
      applySessionMasterVolume("node");
    })
    .catch((error: unknown) => {
      console.warn("[import] Could not apply the Speakers level", error);
    });
}

/**
 * Applies prevalidated collection changes together, then commits the imported
 * open patch as an undo step only after synchronous persistence acceptance.
 */
function applyImportedChanges(
  graph: NodeGraph | null,
  writeData: () => void,
  masterVolume?: number
): void {
  const transaction = createTransaction({
    mutationFn: ({ transaction: pending }) => {
      const collections = [
        radiosCollection,
        settingsCollection,
        sessionRadiosCollection,
        playbackSessionsCollection,
      ] as const;
      const attempted: (typeof collections)[number][] = [];
      try {
        for (const collection of collections) {
          attempted.push(collection);
          collection.utils.acceptMutations(pending);
        }
      } catch (error) {
        // Adapters can have persisted an earlier collection before one fails.
        // Restore both their storage caches and synced rows before rollback.
        const restore = {
          mutations: pending.mutations.map((mutation) => ({
            ...mutation,
            changes: mutation.original,
            modified: mutation.original,
            original: mutation.modified,
            type:
              mutation.type === "insert"
                ? ("delete" as const)
                : ("update" as const),
          })),
        };
        const failures = [error];
        for (const collection of attempted.reverse()) {
          try {
            collection.utils.acceptMutations(restore);
          } catch (restoreError) {
            failures.push(restoreError);
          }
        }
        throw failures.length === 1
          ? error
          : new AggregateError(
              failures,
              "Import failed and could not restore storage"
            );
      }
      // Acceptance is entirely synchronous; no later rejection can change
      // collections after this helper commits the editor/history or toast.
      return Promise.resolve();
    },
  });
  // A synchronous mutation failure is rethrown below; consume its rollback
  // promise too because the public import API is synchronous.
  transaction.isPersisted.promise.catch((error) => {
    if (error) {
      console.error("Import persistence failed:", error);
    }
  });
  let written: NodeGraph | null = null;
  try {
    transaction.mutate(() => {
      writeData();
      written = graph
        ? writeNodeSessionGraph(graph, masterVolume, { replaceReadOnly: true })
        : null;
    });
  } catch (error) {
    transaction.rollback();
    throw error;
  }
  if (transaction.state === "failed") {
    throw transaction.error?.error;
  }
  const importedGraph = written;
  if (importedGraph) {
    if (nodeStore.state.readOnlyVersion === null) {
      commitNodeGraph(() => importedGraph, nodeStore, "snapshot");
    } else {
      loadNodeGraph(importedGraph);
    }
    applyImportedMasterVolume();
  }
}

function prepareImportedSettings(importData: DatabaseExport) {
  const existing = getSettings();
  const player = normalizeImportedSettings(importData.settings);
  return settingsCollection.validateData(
    {
      ...existing,
      id: SETTINGS_ID,
      player: {
        mode: normalizePlayerMode(player.mode ?? existing?.player.mode),
        restoreStateOnLoad:
          player.restoreStateOnLoad ??
          existing?.player.restoreStateOnLoad ??
          true,
      },
    },
    "insert"
  );
}

function applyImportedSettings(
  settings: ReturnType<typeof prepareImportedSettings>
) {
  if (getSettings()) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player = settings.player;
    });
  } else {
    settingsCollection.insert(settings);
  }
}

function prepareImportedRadio(
  radio: Radio,
  id: string,
  enabled: boolean,
  order: number
): RadioRecord {
  return radiosCollection.validateData(
    {
      countryTitle: undefined,
      description: radio.description,
      enabled,
      id,
      logoUrl: radio.logoUrl,
      metadataConfig: radio.metadataConfig,
      name: radio.name,
      order,
      placeTitle: undefined,
      platformMetadata: radio.platformMetadata,
      streamFormat: radio.streamFormat,
      streamUrl: radio.streamUrl,
      websiteUrl: radio.websiteUrl,
    },
    "insert"
  );
}

function hasRadioImportChanges(
  existing: RadioRecord,
  imported: Radio
): boolean {
  return (
    existing.streamUrl !== imported.streamUrl ||
    (imported.streamFormat !== undefined &&
      existing.streamFormat !== imported.streamFormat) ||
    existing.logoUrl !== imported.logoUrl ||
    existing.description !== imported.description ||
    existing.websiteUrl !== imported.websiteUrl ||
    (imported.metadataConfig !== undefined &&
      JSON.stringify(existing.metadataConfig) !==
        JSON.stringify(imported.metadataConfig))
  );
}

function checkImportedRadioIds(
  radios: RadioRecord[],
  existingIds: string[] = []
): void {
  const ids = new Set(existingIds);
  for (const radio of radios) {
    if (ids.has(radio.id)) {
      throw new Error("Duplicate radio IDs");
    }
    ids.add(radio.id);
  }
}

function getExportVersion(
  data: Pick<
    DatabaseExport,
    "missingNamModels" | "namModels" | "sessions" | "settings"
  >
): number {
  const hasNodeData =
    data.sessions !== undefined ||
    data.namModels !== undefined ||
    data.missingNamModels !== undefined ||
    data.settings.player.mode === "node";
  return hasNodeData ? EXPORT_VERSION : LIBRARY_EXPORT_VERSION;
}

/** The Node patch for a file backup, when the node session holds one. */
function exportSessions(): DatabaseExport["sessions"] {
  const session = playbackSessionsCollection.state.get("node");
  return session?.graph
    ? { node: { graph: session.graph, masterVolume: session.masterVolume } }
    : undefined;
}

/**
 * The file backup: stations, settings and the Node patch. A share link
 * leaves the patch out.
 */
export const createDatabaseExport = async (): Promise<DatabaseExport> => {
  const radios = Array.from(radiosCollection.state.values());
  const settings = getSettings();
  const graph = playbackSessionsCollection.state.get("node")?.graph ?? null;
  const sessions = exportSessions();
  const namModels = await exportNamModels(graph);
  if (namModels.missing) {
    console.warn(
      "[export] Backing up without missing local NAM models",
      namModels.missing
    );
  }

  const backup: Omit<DatabaseExport, "version"> = {
    exportDate: new Date().toISOString(),
    missingNamModels: namModels.missing,
    namModels: namModels.models,
    radios: radios as unknown as Radio[],
    sessions,
    settings: (settings || {
      id: SETTINGS_ID,
      player: { mode: "single" },
    }) as unknown as DatabaseExport["settings"],
  };
  return { ...backup, version: getExportVersion(backup) };
};

/**
 * Export the entire database to a JSON file
 */
export const exportDatabase = async (): Promise<void> => {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    throw new Error("Export can only be used in browser environment");
  }

  try {
    const backup = await createDatabaseExport();
    const jsonString = JSON.stringify(backup, null, 2);
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
    const missing = backup.missingNamModels?.length ?? 0;
    if (missing > 0) {
      toast.warning(
        missing === 1
          ? "Backup downloaded without 1 NAM model missing on this device"
          : `Backup downloaded without ${missing} NAM models missing on this device`
      );
    } else {
      toast.success("Backup downloaded");
    }
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

    const link: Omit<DatabaseExport, "version"> = {
      exportDate: new Date().toISOString(),
      radios: radios as unknown as Radio[],
      settings: (settings || {
        id: SETTINGS_ID,
        player: { mode: "single" },
      }) as unknown as DatabaseExport["settings"],
    };
    const exportData: DatabaseExport = {
      ...link,
      version: getExportVersion(link),
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
        ? {
            ...data,
            missingNamModels: undefined,
            namModels: undefined,
            sessions: undefined,
          }
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

  if (!isRecord(exportData.settings)) {
    throw new Error("Invalid settings data");
  }

  for (const radio of exportData.radios) {
    if (!isRecord(radio)) {
      throw new Error("Invalid radio data");
    }
    radiosCollection.validateData(
      { ...radio, id: radio.id ? String(radio.id) : "" },
      "insert"
    );
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
  const graph = readImportedNodePatch(importData);
  importData.missingNamModels = validateMissingNamModels(
    exportData.missingNamModels,
    graph
  );
  importData.namModels = validateNamModelBackup(
    exportData.namModels,
    graph,
    importData.missingNamModels
  );
  readImportedMasterVolume(importData);
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
      if (hasRadioImportChanges(existing, importedRadio)) {
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
  const masterVolume = readImportedMasterVolume(importData);
  const storedGraph = playbackSessionsCollection.state.get("node")?.graph;

  return {
    newRadios,
    nodePatch:
      masterVolume === undefined
        ? undefined
        : {
            masterVolume,
            replacesNewerVersion:
              storedGraph !== undefined &&
              migrateNodeGraph(storedGraph).status === "read-only",
          },
    settingsChanged,
    unchangedRadios,
    updatedRadios,
  };
};

/**
 * Replace all data with imported data
 */
const replaceImportedDataSync = (importData: DatabaseExport): void => {
  try {
    const validated = validateImportData(importData);
    const graph = readImportedNodePatch(validated);
    const masterVolume = readImportedMasterVolume(validated);
    const settings = prepareImportedSettings(validated);
    const radios = validated.radios.map((radio) =>
      prepareImportedRadio(
        radio,
        radio.id ? String(radio.id) : generateId(),
        radio.enabled ?? true,
        radio.order ?? 0
      )
    );
    checkImportedRadioIds(radios);
    if (graph) {
      prepareNodeSessionGraph(graph, masterVolume);
    }

    applyImportedChanges(
      graph,
      () => {
        const importedIds = new Set(radios.map((radio) => radio.id));
        for (const radio of Array.from(radiosCollection.state.values())) {
          if (!importedIds.has(radio.id)) {
            radiosCollection.delete(radio.id);
          }
        }
        for (const radio of radios) {
          if (radiosCollection.state.has(radio.id)) {
            radiosCollection.update(radio.id, (draft) => {
              Object.assign(draft, radio);
            });
          } else {
            radiosCollection.insert(radio);
          }
        }
        applyImportedSettings(settings);
      },
      masterVolume
    );

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
const mergeImportedDataSync = (importData: DatabaseExport): void => {
  try {
    const validated = validateImportData(importData);
    const graph = readImportedNodePatch(validated);
    const masterVolume = readImportedMasterVolume(validated);
    const settings = prepareImportedSettings(validated);

    const existingRadios = Array.from(radiosCollection.state.values());
    const inserts: RadioRecord[] = [];
    const updates = new Map<string, RadioRecord>();

    // Merge radios using similar logic to syncRadioData
    const existingRadiosMap = new Map(
      existingRadios.map((radio) => [radio.name, radio])
    );

    let newRadiosCount = 0;
    let updatedRadiosCount = 0;

    for (const importedRadio of validated.radios) {
      const existing = existingRadiosMap.get(importedRadio.name);

      if (existing) {
        // Check if radio data has changed
        const importsMetadataConfig =
          importedRadio.metadataConfig !== undefined;
        const importsStreamFormat = importedRadio.streamFormat !== undefined;
        if (hasRadioImportChanges(existing, importedRadio)) {
          // Validate the full updated record while preserving preferences and
          // optional metadata omitted by older backups.
          updates.set(
            existing.id,
            radiosCollection.validateData(
              {
                ...(updates.get(existing.id) ?? existing),
                description: importedRadio.description,
                logoUrl: importedRadio.logoUrl,
                ...(importsMetadataConfig
                  ? { metadataConfig: importedRadio.metadataConfig }
                  : {}),
                ...(importsStreamFormat
                  ? { streamFormat: importedRadio.streamFormat }
                  : {}),
                streamUrl: importedRadio.streamUrl,
                websiteUrl: importedRadio.websiteUrl,
              },
              "insert"
            )
          );
          updatedRadiosCount += 1;
        }
      } else {
        // New radio - add with disabled state
        const maxOrder = Math.max(
          ...existingRadios.map((r) => r.order || 0),
          0
        );
        inserts.push(
          prepareImportedRadio(
            importedRadio,
            generateId(),
            false,
            maxOrder + newRadiosCount + 1
          )
        );
        newRadiosCount += 1;
      }
    }

    checkImportedRadioIds(
      inserts,
      existingRadios.map((radio) => radio.id)
    );
    if (graph) {
      prepareNodeSessionGraph(graph, masterVolume);
    }
    applyImportedChanges(
      graph,
      () => {
        for (const radio of updates.values()) {
          radiosCollection.update(radio.id, (draft) => {
            Object.assign(draft, radio);
          });
        }
        for (const radio of inserts) {
          radiosCollection.insert(radio);
        }
        applyImportedSettings(settings);
      },
      masterVolume
    );

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

/** Stage local model assets before the synchronous collection transaction. */
function importWithNamModels(
  importData: DatabaseExport,
  apply: (data: DatabaseExport) => void
): void | Promise<void> {
  let validated: DatabaseExport;
  try {
    validated = validateImportData(importData);
  } catch (error) {
    console.error("Import validation failed:", error);
    toast.error("Couldn't import");
    throw error;
  }
  const graph = readImportedNodePatch(validated);
  if (!(graph && hasLocalNamModels(graph))) {
    apply(validated);
    return;
  }
  return prepareImportedNamModels(
    graph,
    validated.namModels,
    validated.missingNamModels
  ).then(
    async (prepared) => {
      try {
        apply({
          ...validated,
          missingNamModels: undefined,
          namModels: undefined,
          sessions: {
            ...validated.sessions,
            node: { ...validated.sessions?.node, graph: prepared.graph },
          },
        });
        if (validated.missingNamModels) {
          toast.warning(
            "Some NAM models were missing from this backup; their amps load without a model"
          );
        }
      } catch (error) {
        await prepared.rollback();
        throw error;
      }
    },
    (error: unknown) => {
      console.error("NAM model import failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Couldn't import NAM models"
      );
      throw error;
    }
  );
}

/** Replace a backup after all required local NAM assets have been restored. */
export const replaceImportedData = (
  importData: DatabaseExport
): void | Promise<void> =>
  importWithNamModels(importData, replaceImportedDataSync);

/** Merge the library and replace its patch after restoring local NAM assets. */
export const mergeImportedData = (
  importData: DatabaseExport
): void | Promise<void> =>
  importWithNamModels(importData, mergeImportedDataSync);

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
