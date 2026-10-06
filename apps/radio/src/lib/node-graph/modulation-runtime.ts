import { Store } from "@tanstack/react-store";
import {
  getAudioContext,
  resumeAudioContext,
} from "@/lib/audio/playback/audio-context";
import { subscribeModulationMidi } from "@/lib/midi/modulation-input";
import type {
  ControlLink,
  ModulationMessage,
  ModulationProgram,
} from "./modulation-dsp";
import {
  type NativeModulationSession,
  nativeModulationNodes,
} from "./modulation-native";
import { isModulationNode, type NodeGraph } from "./schema";
import { analyseGraph } from "./validate";

export const modulationReadouts = new Store<{
  values: Record<string, number>;
  status: "idle" | "starting" | "running" | "suspended" | "error";
  error: string | null;
  backends: Record<string, "openDAW" | "DSP">;
  nativeWarning: string | null;
}>({
  backends: {},
  error: null,
  nativeWarning: null,
  status: "idle",
  values: {},
});

const commands = new Set<(message: ModulationMessage) => void>();

/** Called inside the gesture, so standalone modulation can unlock audio too. */
export function runModulation(): void {
  resumeAudioContext().catch((error: unknown) => {
    modulationReadouts.setState((state) => ({
      ...state,
      error: String(error),
      status: "error",
    }));
  });
}

export function gateModulator(id: string, on: boolean): void {
  if (on) {
    runModulation();
  }
  for (const send of commands) {
    send({ id, on, type: "gate" });
  }
}

/** Lower validated control sources and detector taps for the worklet. */
export function modulationProgram(graph: NodeGraph): ModulationProgram {
  const { wired, issues } = analyseGraph(graph);
  const refusedNodes = new Set(
    issues.filter((issue) => issue.target === "node").map((issue) => issue.id)
  );
  const refusedEdges = new Set(
    issues.filter((issue) => issue.target === "edge").map((issue) => issue.id)
  );
  const nodes = graph.nodes
    .filter(isModulationNode)
    .filter((node) => !refusedNodes.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const audioSources: Record<string, string> = {};
  const links: ControlLink[] = [];
  for (const { edge, to } of wired) {
    if (edge.muted || refusedEdges.has(edge.id) || !ids.has(edge.target)) {
      continue;
    }
    if (to.kind === "audio") {
      audioSources[edge.target] = edge.source;
    } else if (to.kind === "control" && ids.has(edge.source)) {
      links.push({
        depth: edge.depth ?? 1,
        source: edge.source,
        target: edge.target,
      });
    }
  }
  return {
    audioSources,
    followers: nodes
      .filter((node) => node.type === "follower")
      .map((node) => node.id),
    links,
    nodes,
  };
}

type AudioTap = { source: AudioNode; input: number };
const modules = new WeakMap<AudioContext, Promise<void>>();

export function createModulationRuntime({
  onValues,
  getAudioTap,
  getNativeSession,
}: {
  onValues: (values: Readonly<Record<string, number>>) => void;
  /** Follower taps the named node's lane, after its effects and before its fader. */
  getAudioTap: (sourceId: string) => AudioNode | null;
  getNativeSession?: (
    onValue: (id: string, value: number) => void
  ) => Promise<NativeModulationSession | null>;
}) {
  let program: ModulationProgram = { followers: [], links: [], nodes: [] };
  let node: AudioWorkletNode | null = null;
  let silent: GainNode | null = null;
  let context: AudioContext | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  let taps: AudioTap[] = [];
  const queuedGates = new Map<string, boolean>();
  const resetSources = new Set<string>();
  let native: NativeModulationSession | null = null;
  let nativeAttempted = false;
  let nativeQueued = false;
  let nativeValues: Record<string, number> = {};

  const configure = () => {
    const sources = native ? nativeModulationNodes(program, resetSources) : [];
    native?.sync(sources);
    program = { ...program, nativeIds: sources.map((spec) => spec.id) };
    const ids = new Set(program.nativeIds);
    nativeValues = Object.fromEntries(
      Object.entries(nativeValues).filter(([id]) => ids.has(id))
    );
    modulationReadouts.setState((state) => ({
      ...state,
      backends: Object.fromEntries(
        program.nodes.map((spec) => [
          spec.id,
          ids.has(spec.id) ? "openDAW" : "DSP",
        ])
      ),
    }));
    node?.port.postMessage({
      program,
      type: "configure",
    } satisfies ModulationMessage);
  };
  const initializeNative = () => {
    if (
      !getNativeSession ||
      nativeAttempted ||
      nativeModulationNodes(program, resetSources).length === 0
    ) {
      return;
    }
    nativeAttempted = true;
    getNativeSession((id, value) => {
      if (disposed || !program.nativeIds?.includes(id)) {
        return;
      }
      nativeValues[id] = value;
      if (nativeQueued) {
        return;
      }
      nativeQueued = true;
      queueMicrotask(() => {
        nativeQueued = false;
        if (!disposed) {
          node?.port.postMessage({
            type: "native-values",
            values: nativeValues,
          } satisfies ModulationMessage);
        }
      });
    })
      .then((session) => {
        if (disposed) {
          session?.dispose();
          return;
        }
        native = session;
        if (native) {
          configure();
        } else {
          modulationReadouts.setState((state) => ({
            ...state,
            nativeWarning:
              "Native modulation is unavailable; using DSP compatibility.",
          }));
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          native = null;
          modulationReadouts.setState((state) => ({
            ...state,
            nativeWarning: `Native modulation is unavailable: ${String(error)}`,
          }));
        }
      });
  };

  const stateChanged = () => {
    modulationReadouts.setState((state) => ({
      ...state,
      status: context?.state === "running" ? "running" : "suspended",
    }));
  };
  const clearTaps = () => {
    for (const tap of taps) {
      try {
        if (node) {
          tap.source.disconnect(node, 0, tap.input);
        }
      } catch {
        /* The lane may already have gone. */
      }
    }
    taps = [];
  };
  const refreshTaps = () => {
    if (!node) {
      return;
    }
    const next: AudioTap[] = [];
    for (const [input, id] of program.followers.entries()) {
      const sourceId = program.audioSources?.[id];
      const source = sourceId ? getAudioTap(sourceId) : null;
      if (source) {
        next.push({ input, source });
      }
    }
    if (
      next.length === taps.length &&
      next.every(
        (tap, index) =>
          tap.source === taps[index]?.source && tap.input === taps[index]?.input
      )
    ) {
      return;
    }
    clearTaps();
    for (const tap of next) {
      tap.source.connect(node, 0, tap.input);
    }
    taps = next;
  };
  const initialize = () => {
    if (
      disposed ||
      pending ||
      node ||
      program.nodes.length === 0 ||
      typeof AudioWorkletNode === "undefined"
    ) {
      return;
    }
    context = getAudioContext();
    const audio = context;
    modulationReadouts.setState((state) => ({
      ...state,
      error: null,
      status: "starting",
    }));
    let loaded = modules.get(audio);
    if (!loaded) {
      loaded = audio.audioWorklet.addModule("/dsp-processor-bundle.js");
      modules.set(audio, loaded);
      loaded.catch(() => modules.delete(audio));
    }
    pending = loaded
      .then(() => {
        if (disposed) {
          return;
        }
        node = new AudioWorkletNode(audio, "node-modulation-processor", {
          numberOfInputs: 8,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        silent = audio.createGain();
        silent.gain.value = 0;
        node.connect(silent);
        silent.connect(audio.destination);
        node.port.onmessage = ({
          data,
        }: MessageEvent<{ type: string; values: Record<string, number> }>) => {
          if (disposed || data.type !== "values") {
            return;
          }
          // Public SDK telemetry otherwise dispatches on animation frames,
          // which browsers throttle when the radio tab is in the background.
          native?.dispatch();
          refreshTaps();
          modulationReadouts.setState((state) => ({
            ...state,
            values: data.values,
          }));
          onValues(data.values);
        };
        configure();
        initializeNative();
        for (const [id, on] of queuedGates) {
          node.port.postMessage({
            id,
            on,
            type: "gate",
          } satisfies ModulationMessage);
        }
        queuedGates.clear();
        refreshTaps();
        audio.addEventListener("statechange", stateChanged);
        stateChanged();
      })
      .catch((error: unknown) => {
        if (!disposed) {
          modulationReadouts.setState((state) => ({
            ...state,
            error: String(error),
            status: "error",
          }));
        }
      })
      .finally(() => {
        pending = null;
      });
  };
  const send = (message: ModulationMessage) => {
    if (message.type === "gate") {
      if (!node) {
        queuedGates.set(message.id, message.on);
      }
      if (message.on) {
        resetSources.add(message.id);
        configure();
      }
    }
    initialize();
    node?.port.postMessage(message);
  };
  commands.add(send);
  const stopMidi = subscribeModulationMidi((bytes) =>
    send({ bytes: Array.from(bytes), type: "midi" })
  );

  return {
    dispose() {
      disposed = true;
      commands.delete(send);
      stopMidi();
      context?.removeEventListener("statechange", stateChanged);
      clearTaps();
      native?.dispose();
      native = null;
      if (node) {
        node.port.postMessage({ type: "stop" } satisfies ModulationMessage);
        node.port.onmessage = null;
        node.disconnect();
        node.port.close();
      }
      silent?.disconnect();
      node = null;
      silent = null;
      onValues({});
      modulationReadouts.setState(() => ({
        backends: {},
        error: null,
        nativeWarning: null,
        status: "idle",
        values: {},
      }));
    },
    sync(next: NodeGraph) {
      program = modulationProgram(next);
      const retained = new Set(program.nodes.map((spec) => spec.id));
      for (const id of resetSources) {
        if (!retained.has(id)) {
          resetSources.delete(id);
        }
      }
      if (program.nodes.length === 0) {
        configure();
        clearTaps();
        onValues({});
        modulationReadouts.setState((state) => ({ ...state, values: {} }));
        return;
      }
      initialize();
      configure();
      if (node) {
        initializeNative();
      }
      refreshTaps();
      // Removing or muting a cable restores its base even when the context is suspended.
      const ids = new Set(
        program.nodes.filter((spec) => spec.data.enabled).map((spec) => spec.id)
      );
      onValues(
        Object.fromEntries(
          Object.entries(modulationReadouts.state.values).filter(([id]) =>
            ids.has(id)
          )
        )
      );
    },
  };
}
