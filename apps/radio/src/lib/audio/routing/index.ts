/**
 * Routing Module
 *
 * Audio routing utilities for managing output device selection
 * and CUE (headphone) output for DJ functionality.
 */

export {
  createOutputRouter,
  isSinkIdSupported,
  OutputRouter,
  type OutputRouterCallbacks,
  type OutputRouterState,
} from "./output-router.js";
