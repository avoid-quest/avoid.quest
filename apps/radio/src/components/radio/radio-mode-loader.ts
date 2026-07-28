import type { Radio } from "@/lib/audio";
import type { Settings } from "@/lib/types";

type RadioMode = Settings["player"]["mode"];
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

export function preloadRadioMode(mode: RadioMode) {
  return {
    dj: loadDjPlayer,
    multiple: loadMultipleRadios,
    single: loadSingleRadio,
  }[mode]();
}
