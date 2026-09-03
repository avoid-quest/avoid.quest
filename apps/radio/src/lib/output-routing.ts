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

export type MainOutputRoutingSettings = Pick<
  OutputRoutingSettings,
  "mainDelayMs" | "mainOutputId"
>;

export type OutputRoutingSnapshot = {
  cueActive: boolean;
  deckCueEnabled: Record<string, boolean>;
  headphoneVolume: number;
  settings: OutputRoutingSettings;
  sinkSelectionSupported: boolean;
};

export type MainOutputRoutingSnapshot = OutputRoutingSnapshot & {
  cueOutputCleared: boolean;
};

export type OutputBrowserGraph = {
  readonly context: AudioContext;
  readonly mainOutput: AudioNode;
  connectCue: (source: AudioNode) => void;
  connectMain: (source: AudioNode, realtime?: boolean) => void;
  disconnectCue: (source: AudioNode) => void;
  disconnectMain: (source: AudioNode) => void;
  dispose: () => void;
  setCueDelay: (delayMs: number) => void;
  setHeadphoneVolume: (volume: number) => void;
  setMainDelay: (delayMs: number) => void;
};

export type OutputCueSink = {
  readonly deviceId: string;
  dispose: () => void;
};

export type OutputBrowserAdapter = {
  createCueSink: (
    graph: OutputBrowserGraph,
    deviceId: string
  ) => Promise<OutputCueSink>;
  createGraph: (context: AudioContext) => OutputBrowserGraph;
  getContext: () => AudioContext;
  isSinkSelectionSupported: () => boolean;
  setMainSink: (context: AudioContext, deviceId: string) => Promise<void>;
};

export type OutputSettingsAdapter = {
  read: () => OutputRoutingSettings;
  write: (settings: OutputRoutingSettings) => void;
};

export type CueDeckRegistration = {
  readonly enabled: boolean;
  cleanup: () => void;
  replaceTap: (tap: AudioNode | null) => void;
  setEnabled: (enabled: boolean) => void;
};

type DeckConnection = {
  enabled: boolean;
  tap: AudioNode | null;
};

type GraphAttempt = {
  graph: OutputBrowserGraph;
  graphGeneration: number;
};

type SettingsAttempt = GraphAttempt & {
  cueChanged: boolean;
  mainChanged: boolean;
  previous: OutputRoutingSettings;
  settings: OutputRoutingSettings;
  sinkSelectionSupported: boolean;
};

type MainSettingsAttempt = GraphAttempt & {
  cueCollision: boolean;
  mainChanged: boolean;
  mainSettings: MainOutputRoutingSettings;
  persisted: OutputRoutingSettings;
  previous: OutputRoutingSettings;
  settings: OutputRoutingSettings;
  sinkSelectionSupported: boolean;
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
  private cueGeneration = 0;
  private cueSink: OutputCueSink | null = null;
  private readonly decks = new Map<string, DeckConnection>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private graph: OutputBrowserGraph | null = null;
  private graphGeneration = 0;
  private headphoneVolume: number;
  private readonly mainSources = new Set<AudioNode>();
  private readonly options: CreateOutputRoutingOptions;
  private pendingSettingsTransactions = 0;
  private runtimeSettings = DEFAULT_OUTPUT_SETTINGS;
  private settingsTransactionTail: Promise<void> = Promise.resolve();
  private cleanupGeneration = 0;

  constructor(options: CreateOutputRoutingOptions) {
    this.options = options;
    this.headphoneVolume = Math.max(
      0,
      Math.min(1, options.initialHeadphoneVolume ?? 1)
    );
  }

  applySettings(
    patch: Partial<OutputRoutingSettings> = {}
  ): Promise<OutputRoutingSnapshot> {
    const { cleanupGeneration, cueGeneration } = this;
    return this.queueSettingsTransaction(() =>
      this.applyReportedSettingsTransaction(() =>
        this.applySettingsTransaction(patch, cleanupGeneration, cueGeneration)
      )
    );
  }

  applyMainSettings(
    patch: Partial<MainOutputRoutingSettings> = {}
  ): Promise<MainOutputRoutingSnapshot> {
    const { cleanupGeneration } = this;
    return this.queueSettingsTransaction(() =>
      this.applyReportedSettingsTransaction(() =>
        this.applyMainSettingsTransaction(patch, cleanupGeneration)
      )
    );
  }

  private queueSettingsTransaction<T>(run: () => Promise<T>): Promise<T> {
    const transaction =
      this.pendingSettingsTransactions === 0
        ? run()
        : this.settingsTransactionTail.then(run);
    this.pendingSettingsTransactions += 1;
    const settled = transaction.then(
      () => undefined,
      () => undefined
    );
    this.settingsTransactionTail = settled;
    settled.then(() => {
      this.pendingSettingsTransactions -= 1;
    });
    return transaction;
  }

  subscribeErrors(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private async applyReportedSettingsTransaction<T>(
    transaction: () => Promise<T>
  ): Promise<T> {
    try {
      return await transaction();
    } catch (error) {
      const reportedError =
        error instanceof Error ? error : new Error(String(error));
      for (const listener of this.errorListeners) {
        listener(reportedError);
      }
      throw reportedError;
    }
  }

  private async applyMainSettingsTransaction(
    patch: Partial<MainOutputRoutingSettings>,
    cleanupGeneration: number
  ): Promise<MainOutputRoutingSnapshot> {
    this.throwIfTransactionCancelled(cleanupGeneration);

    const snapshot = await this.applyMainSettingsAttempt(
      patch,
      cleanupGeneration
    );
    return (
      snapshot ?? this.applyMainSettingsTransaction(patch, cleanupGeneration)
    );
  }

  private applyMainSettingsAttempt(
    patch: Partial<MainOutputRoutingSettings>,
    cleanupGeneration: number
  ): Promise<MainOutputRoutingSnapshot | null> {
    const persisted = this.options.settings.read();
    const mainSettings = {
      mainDelayMs: Math.max(
        0,
        Math.min(500, patch.mainDelayMs ?? persisted.mainDelayMs)
      ),
      mainOutputId: patch.mainOutputId ?? persisted.mainOutputId,
    };
    const cueCollision =
      mainSettings.mainOutputId === persisted.cueOutputId ||
      mainSettings.mainOutputId === this.runtimeSettings.cueOutputId;
    const settings = {
      ...this.runtimeSettings,
      ...mainSettings,
      ...(cueCollision ? { cueOutputId: null } : {}),
    };
    const graph = this.ensureGraph();
    const previous = this.runtimeSettings;
    if (
      settings.mainOutputId === previous.mainOutputId &&
      settings.mainDelayMs === previous.mainDelayMs &&
      !cueCollision
    ) {
      return Promise.resolve(this.mainSnapshot(settings, false));
    }
    const sinkSelectionSupported =
      this.options.browser.isSinkSelectionSupported();
    if (!sinkSelectionSupported && settings.mainOutputId !== "default") {
      return Promise.reject(
        new Error("Output device selection is not supported")
      );
    }
    return this.applyChangedMainSettingsAttempt(
      {
        cueCollision,
        graph,
        graphGeneration: this.graphGeneration,
        mainChanged: settings.mainOutputId !== previous.mainOutputId,
        mainSettings,
        persisted,
        previous,
        settings,
        sinkSelectionSupported,
      },
      cleanupGeneration
    );
  }

  private async applyChangedMainSettingsAttempt(
    attempt: MainSettingsAttempt,
    cleanupGeneration: number
  ): Promise<MainOutputRoutingSnapshot | null> {
    try {
      await this.applyMainSink(
        attempt.graph,
        attempt.settings,
        attempt.mainChanged,
        attempt.sinkSelectionSupported
      );
      if (this.shouldRetryGraphAttempt(attempt, cleanupGeneration)) {
        return null;
      }
      attempt.graph.setMainDelay(attempt.settings.mainDelayMs);
      if (
        attempt.mainSettings.mainOutputId !== attempt.persisted.mainOutputId ||
        attempt.mainSettings.mainDelayMs !== attempt.persisted.mainDelayMs ||
        (attempt.cueCollision && attempt.persisted.cueOutputId !== null)
      ) {
        this.options.settings.write({
          ...attempt.persisted,
          ...attempt.mainSettings,
          ...(attempt.cueCollision ? { cueOutputId: null } : {}),
        });
      }
      if (attempt.cueCollision) {
        this.commitCueSink(null, true);
      }
      const committedSettings = {
        ...attempt.settings,
        cueOutputId: attempt.cueCollision
          ? null
          : this.runtimeSettings.cueOutputId,
      };
      this.runtimeSettings = committedSettings;
      return this.mainSnapshot(committedSettings, attempt.cueCollision);
    } catch (error) {
      if (this.shouldRetryGraphAttempt(attempt, cleanupGeneration)) {
        return null;
      }
      if (attempt.mainChanged && attempt.sinkSelectionSupported) {
        await this.options.browser
          .setMainSink(attempt.graph.context, attempt.previous.mainOutputId)
          .catch(() => undefined);
      }
      attempt.graph.setMainDelay(attempt.previous.mainDelayMs);
      throw error;
    }
  }

  private async applySettingsTransaction(
    patch: Partial<OutputRoutingSettings>,
    cleanupGeneration: number,
    cueGeneration: number
  ): Promise<OutputRoutingSnapshot> {
    this.throwIfTransactionCancelled(cleanupGeneration);
    this.throwIfCueTransactionCancelled(cueGeneration);

    const snapshot = await this.applySettingsAttempt(
      patch,
      cleanupGeneration,
      cueGeneration
    );
    return (
      snapshot ??
      this.applySettingsTransaction(patch, cleanupGeneration, cueGeneration)
    );
  }

  private applySettingsAttempt(
    patch: Partial<OutputRoutingSettings>,
    cleanupGeneration: number,
    cueGeneration: number
  ): Promise<OutputRoutingSnapshot | null> {
    this.throwIfCueTransactionCancelled(cueGeneration);
    const persisted = this.options.settings.read();
    const settings = normalizeSettings({
      ...persisted,
      ...patch,
    });
    const graph = this.ensureGraph();
    const previous = this.runtimeSettings;
    if (settingsMatch(settings, previous)) {
      if (!settingsMatch(settings, persisted)) {
        this.options.settings.write(settings);
      }
      return Promise.resolve(this.snapshot(settings));
    }
    const sinkSelectionSupported =
      this.options.browser.isSinkSelectionSupported();
    assertSinkSelectionSupported(settings, sinkSelectionSupported);
    const attempt = {
      cueChanged: settings.cueOutputId !== previous.cueOutputId,
      graph,
      graphGeneration: this.graphGeneration,
      mainChanged: settings.mainOutputId !== previous.mainOutputId,
      previous,
      settings,
      sinkSelectionSupported,
    };
    if (!(attempt.mainChanged || attempt.cueChanged)) {
      this.applySettingsState(graph, settings);
      this.runtimeSettings = settings;
      return Promise.resolve(this.snapshot(settings));
    }
    return this.applyChangedSettingsAttempt(
      attempt,
      cleanupGeneration,
      cueGeneration
    );
  }

  private async applyChangedSettingsAttempt(
    attempt: SettingsAttempt,
    cleanupGeneration: number,
    cueGeneration: number
  ): Promise<OutputRoutingSnapshot | null> {
    let nextCueSink: OutputCueSink | null = null;

    try {
      await this.applyMainSink(
        attempt.graph,
        attempt.settings,
        attempt.mainChanged,
        attempt.sinkSelectionSupported
      );
      if (this.shouldRetryGraphAttempt(attempt, cleanupGeneration)) {
        return null;
      }
      this.throwIfCueTransactionCancelled(cueGeneration);
      nextCueSink = await this.stageCueSink(
        attempt.graph,
        attempt.settings,
        attempt.cueChanged
      );
      if (this.shouldRetryGraphAttempt(attempt, cleanupGeneration)) {
        this.disposeStagedCueSink(attempt.cueChanged, nextCueSink);
        return null;
      }
      this.throwIfCueTransactionCancelled(cueGeneration);
      this.applySettingsState(attempt.graph, attempt.settings);
      this.commitCueSink(nextCueSink, attempt.cueChanged);
      this.runtimeSettings = attempt.settings;
      return this.snapshot(attempt.settings);
    } catch (error) {
      this.disposeStagedCueSink(attempt.cueChanged, nextCueSink);
      this.throwIfTransactionCancelled(cleanupGeneration);
      if (this.cueGeneration !== cueGeneration) {
        if (this.isCurrentGraph(attempt.graph, attempt.graphGeneration)) {
          await this.rollbackSettingsTransaction({
            graph: attempt.graph,
            mainChanged: attempt.mainChanged,
            previous: attempt.previous,
            sinkSelectionSupported: attempt.sinkSelectionSupported,
          });
        }
        throw new Error(
          "Output routing transaction was cancelled by CUE release",
          { cause: error }
        );
      }
      if (this.shouldRetryGraphAttempt(attempt, cleanupGeneration)) {
        return null;
      }
      await this.rollbackSettingsTransaction({
        graph: attempt.graph,
        mainChanged: attempt.mainChanged,
        previous: attempt.previous,
        sinkSelectionSupported: attempt.sinkSelectionSupported,
      });
      throw error;
    }
  }

  private disposeStagedCueSink(
    cueChanged: boolean,
    cueSink: OutputCueSink | null
  ): void {
    if (cueChanged && cueSink !== this.cueSink) {
      cueSink?.dispose();
    }
  }

  private isCurrentGraph(
    graph: OutputBrowserGraph,
    generation: number
  ): boolean {
    return this.graph === graph && this.graphGeneration === generation;
  }

  private shouldRetryGraphAttempt(
    attempt: GraphAttempt,
    cleanupGeneration: number
  ): boolean {
    if (this.cleanupGeneration !== cleanupGeneration) {
      throw new Error("Output routing transaction was cancelled by cleanup");
    }
    return !this.isCurrentGraph(attempt.graph, attempt.graphGeneration);
  }

  private throwIfTransactionCancelled(cleanupGeneration: number): void {
    if (this.cleanupGeneration !== cleanupGeneration) {
      throw new Error("Output routing transaction was cancelled by cleanup");
    }
  }

  private throwIfCueTransactionCancelled(cueGeneration: number): void {
    if (this.cueGeneration !== cueGeneration) {
      throw new Error(
        "Output routing transaction was cancelled by CUE release"
      );
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
    graph,
    mainChanged,
    previous,
    sinkSelectionSupported,
  }: {
    graph: OutputBrowserGraph;
    mainChanged: boolean;
    previous: OutputRoutingSettings;
    sinkSelectionSupported: boolean;
  }): Promise<void> {
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

  connectMain(source: AudioNode, realtime = false): () => void {
    const graph = this.ensureGraph(source.context as AudioContext);
    if (!this.mainSources.has(source)) {
      this.mainSources.add(source);
      graph.connectMain(source, realtime);
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
    const { cleanupGeneration, cueGeneration } = this;
    return this.queueSettingsTransaction(() =>
      this.applyReportedSettingsTransaction(() => {
        this.throwIfTransactionCancelled(cleanupGeneration);
        this.throwIfCueTransactionCancelled(cueGeneration);
        this.ensureGraph(context);
        return this.applySettingsTransaction(
          {},
          cleanupGeneration,
          cueGeneration
        );
      })
    );
  }

  setHeadphoneVolume(volume: number): void {
    this.headphoneVolume = Math.max(0, Math.min(1, volume));
    this.ensureGraph().setHeadphoneVolume(this.headphoneVolume);
    this.options.onHeadphoneVolumeChange?.(this.headphoneVolume);
  }

  cleanup(): void {
    this.cleanupGeneration += 1;
    this.graphGeneration += 1;
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
    this.runtimeSettings = DEFAULT_OUTPUT_SETTINGS;
  }

  releaseCue(): void {
    this.cueGeneration += 1;
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
    this.graphGeneration += 1;
    this.graph.setHeadphoneVolume(this.headphoneVolume);
    return this.graph;
  }

  private createDeckRegistration(
    deckId: string,
    connection: DeckConnection
  ): CueDeckRegistration {
    return {
      cleanup: () => {
        if (this.decks.get(deckId) !== connection) {
          return;
        }
        if (connection.enabled && connection.tap) {
          this.graph?.disconnectCue(connection.tap);
        }
        this.decks.delete(deckId);
      },
      get enabled() {
        return connection.enabled;
      },
      replaceTap: (tap) => {
        if (this.restoreDeckRegistration(deckId, connection)) {
          this.replaceDeckTap(connection, tap);
        }
      },
      setEnabled: (enabled) => {
        if (this.restoreDeckRegistration(deckId, connection)) {
          this.setDeckEnabled(deckId, connection, enabled);
        }
      },
    };
  }

  private restoreDeckRegistration(
    deckId: string,
    connection: DeckConnection
  ): boolean {
    const current = this.decks.get(deckId);
    if (current) {
      return current === connection;
    }
    this.decks.set(deckId, connection);
    return true;
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

  private mainSnapshot(
    settings: OutputRoutingSettings,
    cueOutputCleared: boolean
  ): MainOutputRoutingSnapshot {
    return { ...this.snapshot(settings), cueOutputCleared };
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
      draft.audio = {
        ...current.audio,
        cueOutputId: settings.cueOutputId,
        delay: {
          cueDelayMs: settings.cueDelayMs,
          mainDelayMs: settings.mainDelayMs,
        },
        mainOutputId: settings.mainOutputId,
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
