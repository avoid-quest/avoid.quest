import type { Radio } from "@/lib/audio";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";

type ModeComponentProps = { radios?: Radio[] };

let singlePromise: Promise<{
  default: React.ComponentType<ModeComponentProps>;
}>;
let nodePromise: Promise<{
  default: React.ComponentType<ModeComponentProps>;
}>;
let djPromise: Promise<{ default: React.ComponentType<ModeComponentProps> }>;

export function loadSingleRadio() {
  singlePromise ??= Promise.all([
    import("./single"),
    import("@/lib/collections/playback-sessions"),
  ]).then(async ([component, sessions]) => {
    await sessions.initializePlaybackSessions();
    return { default: component.SingleRadio };
  });
  return singlePromise;
}

export function loadNodeRadios() {
  nodePromise ??= Promise.all([
    import("./node"),
    import("@/lib/collections/playback-sessions"),
  ]).then(async ([component, sessions]) => {
    await sessions.initializePlaybackSessions();
    return { default: component.NodeRadios };
  });
  return nodePromise;
}

export function loadDjPlayer() {
  djPromise ??= Promise.all([
    import("./dj/dj-player"),
    import("@/lib/collections/playback-sessions"),
  ]).then(async ([component, sessions]) => {
    await sessions.initializePlaybackSessions();
    return { default: component.DjPlayer };
  });
  return djPromise;
}

/** Preloads a mode's chunk; a legacy or unknown mode is normalised first. */
export function preloadRadioMode(mode: unknown) {
  return {
    dj: loadDjPlayer,
    node: loadNodeRadios,
    single: loadSingleRadio,
  }[normalizePlayerMode(mode)]();
}
