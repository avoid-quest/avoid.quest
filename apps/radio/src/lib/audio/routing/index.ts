/**
 * Routing Module
 *
 * Audio routing utilities for managing output device selection,
 * CUE (headphone) output, and output delays for DJ functionality.
 */

export { isSinkIdSupported, safeDisconnectFrom } from "../utils.js";
export {
  CueBus,
  type CueBusCallbacks,
  type CueBusState,
  type CueMode,
  createCueBus,
} from "./cue-bus.js";
export {
  createOutputDelay,
  defaultOutputDelayConfig,
  OutputDelay,
  type OutputDelayConfig,
} from "./output-delay.js";
export {
  createOutputRouter,
  OutputRouter,
  type OutputRouterCallbacks,
  type OutputRouterState,
} from "./output-router.js";
