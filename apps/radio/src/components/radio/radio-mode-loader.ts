import type { Radio } from "@/lib/audio";
import { preparePlaybackSessions } from "@/lib/collections/initialize";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";

type ModeComponentProps = { radios?: Radio[] };

let singlePromise:
  | Promise<{
      default: React.ComponentType<ModeComponentProps>;
    }>
  | undefined;
let nodePromise:
  | Promise<{
      default: React.ComponentType<ModeComponentProps>;
    }>
  | undefined;
let djPromise:
  | Promise<{ default: React.ComponentType<ModeComponentProps> }>
  | undefined;

export function loadSingleRadio() {
  singlePromise ??= Promise.all([import("./single"), preparePlaybackSessions()])
    .then(([component]) => ({ default: component.SingleRadio }))
    .catch((error: unknown) => {
      singlePromise = undefined;
      throw error;
    });
  return singlePromise;
}

export function loadNodeRadios() {
  // Match useIsMobile's 768px breakpoint. Keep the same dynamic boundary as
  // Node's shell, including its SSR guard; phones keep their existing discovery.
  if (
    !import.meta.env.SSR &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(max-width: 767px)").matches
  ) {
    import("./node/node-canvas").catch((error: unknown) => {
      console.error("[radio] Failed to preload Node canvas:", error);
    });
  }
  nodePromise ??= Promise.all([import("./node"), preparePlaybackSessions()])
    .then(([component]) => ({ default: component.NodeRadios }))
    .catch((error: unknown) => {
      nodePromise = undefined;
      throw error;
    });
  return nodePromise;
}

export function loadDjPlayer() {
  djPromise ??= Promise.all([
    import("./dj/dj-player"),
    preparePlaybackSessions(),
  ])
    .then(([component]) => ({ default: component.DjPlayer }))
    .catch((error: unknown) => {
      djPromise = undefined;
      throw error;
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
