/**
 * Routing Module
 *
 * Audio routing utilities for managing output device selection
 * and CUE (headphone) output for DJ functionality.
 */

export {
  CueBus,
  type CueBusCallbacks,
  type CueBusState,
  type CueMode,
  createCueBus,
} from "./cue-bus.js";

export {
  createOutputRouter,
  isSinkIdSupported,
  OutputRouter,
  type OutputRouterCallbacks,
  type OutputRouterState,
} from "./output-router.js";
