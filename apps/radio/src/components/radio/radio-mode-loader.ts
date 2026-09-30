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
  // Node has no UI yet, and `Radios` renders a mode it lacks as Single.
  if (mode === "node") {
    return loadSingleRadio();
  }
  return {
    dj: loadDjPlayer,
    multiple: loadMultipleRadios,
    single: loadSingleRadio,
  }[mode]();
}
