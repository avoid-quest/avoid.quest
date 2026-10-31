import type { ModeTransitionSnapshot } from "@/lib/mode-lifecycle-manager";
import type { ModeLifecycleRequests } from "@/lib/mode-lifecycle-requests";

const IDLE: ModeTransitionSnapshot = {
  currentMode: null,
  error: null,
  phase: "inactive",
  requestedMode: null,
};

/**
 * Storybook's idle stand-in for `@/lib/mode-lifecycle-requests`: no mode
 * starts, so no audio engine, stream or device is touched. Storybook's Vite
 * config swaps it in; the app never imports this file.
 */
export const modeLifecycleRequests: ModeLifecycleRequests = {
  getTransitionSnapshot: () => IDLE,
  requestMode: () => Promise.resolve(),
  resetPageLifecycleState: () => undefined,
  subscribeTransitionSnapshot: () => () => undefined,
  synchronizeMode: () => Promise.resolve(),
};
