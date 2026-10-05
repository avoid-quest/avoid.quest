/**
 * Audio Utilities
 *
 * Shared utility functions for audio routing and device management.
 */

/**
 * Check if setSinkId is supported in the current browser
 * setSinkId allows routing audio to specific output devices
 */
export function isSinkIdSupported(): boolean {
  if (typeof AudioContext === "undefined") {
    return false;
  }
  return "setSinkId" in AudioContext.prototype;
}

/**
 * Check if an `<audio>` element can choose its output device
 * (`HTMLMediaElement.setSinkId`), which ships apart from
 * `AudioContext.setSinkId`: Firefox has only this one.
 */
export function isMediaElementSinkIdSupported(): boolean {
  if (typeof HTMLMediaElement === "undefined") {
    return false;
  }
  return "setSinkId" in HTMLMediaElement.prototype;
}

/**
 * Safely disconnect an AudioNode from all destinations,
 * ignoring "already disconnected" errors.
 */
export function safeDisconnect(
  node: AudioNode | null,
  _context?: string
): void {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch (error) {
    if (error instanceof DOMException && error.name === "InvalidAccessError") {
      return;
    }
    throw error;
  }
}

/**
 * Safely disconnect an AudioNode from a specific destination,
 * catching "not connected" errors.
 * Re-throws unexpected errors for proper error handling.
 *
 * @param source - The source AudioNode to disconnect
 * @param destination - The destination AudioNode to disconnect from
 * @param _context - Reserved for future debugging
 */
export function safeDisconnectFrom(
  source: AudioNode | null,
  destination: AudioNode,
  _context: string
): void {
  if (!source) {
    return;
  }

  try {
    source.disconnect(destination);
  } catch (error) {
    // InvalidAccessError is expected when nodes aren't connected
    if (error instanceof DOMException && error.name === "InvalidAccessError") {
      return;
    }
    // Re-throw unexpected errors
    throw error;
  }
}
