import type { Radio } from "@/lib/audio";
import type { SettingsRecord } from "@/lib/collections/settings";

type PlayerMode = SettingsRecord["player"]["mode"];
type ModeComponentProps = { radios?: Radio[] };

let singlePromise: Promise<{
  default: React.ComponentType<ModeComponentProps>;
}>;
let multiplePromise: Promise<{
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

export function loadMultipleRadios() {
  multiplePromise ??= Promise.all([
    import("./multiple"),
    import("@/lib/collections/playback-sessions"),
  ]).then(async ([component, sessions]) => {
    await sessions.initializePlaybackSessions();
    return { default: component.MultipleRadios };
  });
  return multiplePromise;
}

export function loadNodeRadios() {
  nodePromise ??= Promise.all([
    import("./node"),
    import("@/lib/collections/playback-sessions"),
    import("@/lib/node-graph/node-session"),
  ]).then(async ([component, sessions, nodeSession]) => {
    await sessions.initializePlaybackSessions();
    nodeSession.ensureNodePlaybackSession();
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

export function preloadRadioMode(mode: PlayerMode) {
  return {
    dj: loadDjPlayer,
    multiple: loadMultipleRadios,
    node: loadNodeRadios,
    single: loadSingleRadio,
  }[mode]();
}
