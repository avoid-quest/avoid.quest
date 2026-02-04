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
 * Safely disconnect an AudioNode from all destinations,
 * ignoring "already disconnected" errors.
 */
export function safeDisconnect(node: AudioNode | null, context?: string): void {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch (error) {
    if (
      !(error instanceof DOMException && error.name === "InvalidAccessError")
    ) {
      console.warn(
        `[${context ?? "Audio"}] Unexpected disconnect error:`,
        error
      );
    }
  }
}

/**
 * Safely disconnect an AudioNode from a specific destination,
 * catching "not connected" errors.
 * Re-throws unexpected errors for proper error handling.
 *
 * @param source - The source AudioNode to disconnect
 * @param destination - The destination AudioNode to disconnect from
 * @param context - Context string for error logging
 */
export function safeDisconnectFrom(
  source: AudioNode | null,
  destination: AudioNode,
  context: string
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
    console.error(`[${context}] Unexpected disconnect error:`, error);
    throw error;
  }
}
