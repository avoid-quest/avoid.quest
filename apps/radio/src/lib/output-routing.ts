import { createBrowserOutputAdapter } from "./audio/routing/browser-output-adapter.js";
import {
  getAudioSettings,
  getDelaySettings,
  getSettings,
  settingsCollection,
} from "./collections/settings.js";

export type OutputRoutingSettings = {
  cueDelayMs: number;
  cueOutputId: string | null;
  mainDelayMs: number;
  mainOutputId: string;
};

export type OutputRoutingSnapshot = {
  cueActive: boolean;
  deckCueEnabled: Record<string, boolean>;
  headphoneVolume: number;
  settings: OutputRoutingSettings;
  sinkSelectionSupported: boolean;
};

export type OutputBrowserGraph = {
  readonly context: AudioContext;
  readonly mainOutput: AudioNode;
  connectCue(source: AudioNode): void;
  connectMain(source: AudioNode): void;
  disconnectCue(source: AudioNode): void;
  disconnectMain(source: AudioNode): void;
  dispose(): void;
  setCueDelay(delayMs: number): void;
  setHeadphoneVolume(volume: number): void;
  setMainDelay(delayMs: number): void;
};

export type OutputCueSink = {
  readonly deviceId: string;
  dispose(): void;
};

export type OutputBrowserAdapter = {
  createCueSink(
    graph: OutputBrowserGraph,
    deviceId: string
  ): Promise<OutputCueSink>;
  createGraph(context: AudioContext): OutputBrowserGraph;
  getContext(): AudioContext;
  isSinkSelectionSupported(): boolean;
  setMainSink(context: AudioContext, deviceId: string): Promise<void>;
};

export type OutputSettingsAdapter = {
  read(): OutputRoutingSettings;
  write(settings: OutputRoutingSettings): void;
};

export type CueDeckRegistration = {
  readonly enabled: boolean;
  cleanup(): void;
  replaceTap(tap: AudioNode | null): void;
  setEnabled(enabled: boolean): void;
};

type DeckConnection = {
  enabled: boolean;
  tap: AudioNode | null;
};

type CreateOutputRoutingOptions = {
  browser: OutputBrowserAdapter;
  initialHeadphoneVolume?: number;
  onDeckCueChange?: (deckId: string, enabled: boolean) => void;
  onHeadphoneVolumeChange?: (volume: number) => void;
  settings: OutputSettingsAdapter;
};

const DEFAULT_OUTPUT_SETTINGS: OutputRoutingSettings = {
  cueDelayMs: 0,
  cueOutputId: null,
  mainDelayMs: 0,
  mainOutputId: "default",
};

function normalizeSettings(
  settings: OutputRoutingSettings
): OutputRoutingSettings {
  return {
    ...settings,
    cueDelayMs: Math.max(0, Math.min(500, settings.cueDelayMs)),
    cueOutputId:
      settings.cueOutputId === settings.mainOutputId
        ? null
        : settings.cueOutputId,
    mainDelayMs: Math.max(0, Math.min(500, settings.mainDelayMs)),
  };
}

function settingsMatch(
  left: OutputRoutingSettings,
  right: OutputRoutingSettings
): boolean {
  return (
    left.mainOutputId === right.mainOutputId &&
    left.cueOutputId === right.cueOutputId &&
    left.mainDelayMs === right.mainDelayMs &&
    left.cueDelayMs === right.cueDelayMs
  );
}

function assertSinkSelectionSupported(
  settings: OutputRoutingSettings,
  supported: boolean
): void {
  if (
    !supported &&
    (settings.mainOutputId !== "default" || settings.cueOutputId !== null)
  ) {
    throw new Error("Output device selection is not supported");
  }
}

class OutputRouting {
  private cueSink: OutputCueSink | null = null;
  private readonly decks = new Map<string, DeckConnection>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private graph: OutputBrowserGraph | null = null;
  private headphoneVolume: number;
  private readonly mainSources = new Set<AudioNode>();
  private readonly options: CreateOutputRoutingOptions;
  private runtimeSettings = DEFAULT_OUTPUT_SETTINGS;

  constructor(options: CreateOutputRoutingOptions) {
    this.options = options;
    this.headphoneVolume = Math.max(
      0,
      Math.min(1, options.initialHeadphoneVolume ?? 1)
    );
  }

  async applySettings(
    patch: Partial<OutputRoutingSettings> = {}
  ): Promise<OutputRoutingSnapshot> {
    try {
      return await this.applySettingsTransaction(patch);
    } catch (error) {
      const reportedError =
        error instanceof Error ? error : new Error(String(error));
      for (const listener of this.errorListeners) {
        listener(reportedError);
      }
      throw reportedError;
    }
  }

  subscribeErrors(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private async applySettingsTransaction(
    patch: Partial<OutputRoutingSettings>
  ): Promise<OutputRoutingSnapshot> {
    const settings = normalizeSettings({
      ...this.options.settings.read(),
      ...patch,
    });
    const graph = this.ensureGraph();
    const previous = this.runtimeSettings;
    if (settingsMatch(settings, previous)) {
      return this.snapshot(settings);
    }
    const sinkSelectionSupported =
      this.options.browser.isSinkSelectionSupported();
    assertSinkSelectionSupported(settings, sinkSelectionSupported);
    const mainChanged = settings.mainOutputId !== previous.mainOutputId;
    const cueChanged = settings.cueOutputId !== previous.cueOutputId;
    if (!(mainChanged || cueChanged)) {
      this.applySettingsState(graph, settings);
      this.runtimeSettings = settings;
      return this.snapshot(settings);
    }
    let nextCueSink = this.cueSink;

    try {
      await this.applyMainSink(
        graph,
        settings,
        mainChanged,
        sinkSelectionSupported
      );
      nextCueSink = await this.stageCueSink(graph, settings, cueChanged);
      this.applySettingsState(graph, settings);
      this.commitCueSink(nextCueSink, cueChanged);
      this.runtimeSettings = settings;
      return this.snapshot(settings);
    } catch (error) {
      await this.rollbackSettingsTransaction({
        cueChanged,
        graph,
        mainChanged,
        nextCueSink,
        previous,
        sinkSelectionSupported,
      });
      throw error;
    }
  }

  private applySettingsState(
    graph: OutputBrowserGraph,
    settings: OutputRoutingSettings
  ): void {
    graph.setMainDelay(settings.mainDelayMs);
    graph.setCueDelay(settings.cueDelayMs);
    this.options.settings.write(settings);
  }

  private async applyMainSink(
    graph: OutputBrowserGraph,
    settings: OutputRoutingSettings,
    changed: boolean,
    supported: boolean
  ): Promise<void> {
    if (changed && supported) {
      await this.options.browser.setMainSink(
        graph.context,
        settings.mainOutputId
      );
    }
  }

  private stageCueSink(
    graph: OutputBrowserGraph,
    settings: OutputRoutingSettings,
    changed: boolean
  ): Promise<OutputCueSink | null> {
    if (!(changed && settings.cueOutputId)) {
      return Promise.resolve(changed ? null : this.cueSink);
    }
    return this.options.browser.createCueSink(graph, settings.cueOutputId);
  }

  private commitCueSink(
    nextCueSink: OutputCueSink | null,
    changed: boolean
  ): void {
    if (!changed) {
      return;
    }
    this.cueSink?.dispose();
    this.cueSink = nextCueSink;
    if (!this.cueSink) {
      for (const [deckId, connection] of this.decks) {
        this.setDeckEnabled(deckId, connection, false);
      }
    }
    this.reconcileDeckConnections();
  }

  private async rollbackSettingsTransaction({
    cueChanged,
    graph,
    mainChanged,
    nextCueSink,
    previous,
    sinkSelectionSupported,
  }: {
    cueChanged: boolean;
    graph: OutputBrowserGraph;
    mainChanged: boolean;
    nextCueSink: OutputCueSink | null;
    previous: OutputRoutingSettings;
    sinkSelectionSupported: boolean;
  }): Promise<void> {
    if (cueChanged && nextCueSink !== this.cueSink) {
      nextCueSink?.dispose();
    }
    if (mainChanged && sinkSelectionSupported) {
      await this.options.browser
        .setMainSink(graph.context, previous.mainOutputId)
        .catch(() => undefined);
    }
    graph.setMainDelay(previous.mainDelayMs);
    graph.setCueDelay(previous.cueDelayMs);
  }

  registerCueDeck(
    deckId: string,
    tap: AudioNode | null,
    enabled = false
  ): CueDeckRegistration {
    const existing = this.decks.get(deckId);
    if (existing) {
      this.replaceDeckTap(existing, tap);
      this.setDeckEnabled(deckId, existing, enabled);
      return this.createDeckRegistration(deckId, existing);
    }

    const connection = { enabled: false, tap };
    this.decks.set(deckId, connection);
    this.setDeckEnabled(deckId, connection, enabled);
    return this.createDeckRegistration(deckId, connection);
  }

  connectMain(source: AudioNode): () => void {
    const graph = this.ensureGraph(source.context as AudioContext);
    if (!this.mainSources.has(source)) {
      this.mainSources.add(source);
      graph.connectMain(source);
    }
    return () => {
      if (!this.mainSources.delete(source)) {
        return;
      }
      if (this.graph?.context === source.context) {
        this.graph.disconnectMain(source);
      }
    };
  }

  getMainOutput(context = this.options.browser.getContext()): AudioNode {
    return this.ensureGraph(context).mainOutput;
  }

  getSnapshot(): OutputRoutingSnapshot {
    return this.snapshot(this.runtimeSettings);
  }

  replaceContext(context: AudioContext): Promise<OutputRoutingSnapshot> {
    this.ensureGraph(context);
    return this.applySettings();
  }

  setHeadphoneVolume(volume: number): void {
    this.headphoneVolume = Math.max(0, Math.min(1, volume));
    this.ensureGraph().setHeadphoneVolume(this.headphoneVolume);
    this.options.onHeadphoneVolumeChange?.(this.headphoneVolume);
  }

  cleanup(): void {
    if (this.graph) {
      for (const source of this.mainSources) {
        this.graph.disconnectMain(source);
      }
      for (const connection of this.decks.values()) {
        if (connection.enabled && connection.tap) {
          this.graph.disconnectCue(connection.tap);
        }
        connection.enabled = false;
        connection.tap = null;
      }
    }
    this.mainSources.clear();
    this.decks.clear();
    this.cueSink?.dispose();
    this.cueSink = null;
    this.graph?.dispose();
    this.graph = null;
    this.headphoneVolume = 1;
    this.runtimeSettings = DEFAULT_OUTPUT_SETTINGS;
    this.errorListeners.clear();
  }

  releaseCue(): void {
    for (const connection of this.decks.values()) {
      if (connection.enabled && connection.tap) {
        this.graph?.disconnectCue(connection.tap);
      }
    }
    this.cueSink?.dispose();
    this.cueSink = null;
    this.runtimeSettings = {
      ...this.runtimeSettings,
      cueOutputId: null,
    };
  }

  private ensureGraph(
    context = this.options.browser.getContext()
  ): OutputBrowserGraph {
    if (this.graph?.context === context) {
      return this.graph;
    }

    if (this.graph) {
      for (const source of this.mainSources) {
        this.graph.disconnectMain(source);
      }
      for (const connection of this.decks.values()) {
        if (connection.enabled && connection.tap) {
          this.graph.disconnectCue(connection.tap);
        }
      }
      this.mainSources.clear();
      this.cueSink?.dispose();
      this.cueSink = null;
      this.graph.dispose();
      this.runtimeSettings = DEFAULT_OUTPUT_SETTINGS;
    }

    this.graph = this.options.browser.createGraph(context);
    this.graph.setHeadphoneVolume(this.headphoneVolume);
    return this.graph;
  }

  private createDeckRegistration(
    deckId: string,
    connection: DeckConnection
  ): CueDeckRegistration {
    return {
      get enabled() {
        return connection.enabled;
      },
      cleanup: () => {
        if (this.decks.get(deckId) !== connection) {
          return;
        }
        if (connection.enabled && connection.tap) {
          this.graph?.disconnectCue(connection.tap);
        }
        this.decks.delete(deckId);
      },
      replaceTap: (tap) => {
        if (this.decks.get(deckId) === connection) {
          this.replaceDeckTap(connection, tap);
        }
      },
      setEnabled: (enabled) => {
        if (this.decks.get(deckId) === connection) {
          this.setDeckEnabled(deckId, connection, enabled);
        }
      },
    };
  }

  private reconcileDeckConnections(): void {
    for (const connection of this.decks.values()) {
      if (!(connection.enabled && connection.tap)) {
        continue;
      }
      if (this.cueSink && connection.tap.context === this.graph?.context) {
        this.graph?.connectCue(connection.tap);
      } else {
        this.graph?.disconnectCue(connection.tap);
      }
    }
  }

  private replaceDeckTap(
    connection: DeckConnection,
    tap: AudioNode | null
  ): void {
    if (connection.tap === tap) {
      return;
    }
    if (connection.enabled && connection.tap) {
      this.graph?.disconnectCue(connection.tap);
    }
    connection.tap = tap;
    if (
      connection.enabled &&
      connection.tap &&
      this.cueSink &&
      connection.tap.context === this.graph?.context
    ) {
      this.graph?.connectCue(connection.tap);
    }
  }

  private setDeckEnabled(
    deckId: string,
    connection: DeckConnection,
    enabled: boolean
  ): void {
    const nextEnabled = enabled;
    if (connection.enabled === nextEnabled) {
      return;
    }
    connection.enabled = nextEnabled;
    if (connection.tap) {
      if (
        nextEnabled &&
        this.cueSink &&
        connection.tap.context === this.graph?.context
      ) {
        this.graph?.connectCue(connection.tap);
      } else {
        this.graph?.disconnectCue(connection.tap);
      }
    }
    this.options.onDeckCueChange?.(deckId, nextEnabled);
  }

  private snapshot(settings: OutputRoutingSettings): OutputRoutingSnapshot {
    const deckCueEnabled = Object.fromEntries(
      Array.from(this.decks, ([deckId, connection]) => [
        deckId,
        connection.enabled,
      ])
    );
    return {
      cueActive: this.cueSink !== null,
      deckCueEnabled,
      headphoneVolume: this.headphoneVolume,
      settings: { ...settings },
      sinkSelectionSupported: this.options.browser.isSinkSelectionSupported(),
    };
  }
}

export function createOutputRouting(
  options: CreateOutputRoutingOptions
): OutputRouting {
  return new OutputRouting(options);
}

const collectionOutputSettings: OutputSettingsAdapter = {
  read: () => {
    const audio = getAudioSettings();
    const delay = getDelaySettings();
    return {
      cueDelayMs: delay.cueDelayMs,
      cueOutputId: audio.cueOutputId,
      mainDelayMs: delay.mainDelayMs,
      mainOutputId: audio.mainOutputId,
    };
  },
  write: (settings) => {
    const current = getSettings();
    if (!current) {
      return;
    }
    settingsCollection.update(current.id, (draft) => {
      draft.audio ??= {
        cueOutputId: null,
        mainOutputId: "default",
      };
      draft.audio.mainOutputId = settings.mainOutputId;
      draft.audio.cueOutputId = settings.cueOutputId;
      draft.audio.delay = {
        cueDelayMs: settings.cueDelayMs,
        mainDelayMs: settings.mainDelayMs,
      };
    });
  },
};

let defaultOutputRouting: OutputRouting | null = null;

export function getOutputRouting(): OutputRouting {
  if (!defaultOutputRouting) {
    defaultOutputRouting = createOutputRouting({
      browser: createBrowserOutputAdapter(),
      settings: collectionOutputSettings,
    });
  }
  return defaultOutputRouting;
}

export { OutputRouting };
