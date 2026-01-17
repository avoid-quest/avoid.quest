/**
 * Crossfade Controller
 *
 * Handles smooth crossfade transitions between HTML5 audio elements
 * using Web Audio API for precise gain control.
 */

import type { HTML5AudioPlayer } from "./html5-audio-player.js";
import type { CrossfadeConfig } from "./types.js";

/**
 * Controller for crossfading between two HTML5 audio players
 */
export class CrossfadeController {
  readonly #context: AudioContext;
  readonly #connections = new Map<
    string,
    {
      source: MediaElementAudioSourceNode;
      gain: GainNode;
    }
  >();

  constructor(context: AudioContext) {
    this.#context = context;
  }

  /**
   * Connect an HTML5 audio player to the Web Audio graph
   */
  connect(player: HTML5AudioPlayer): void {
    if (this.#connections.has(player.id)) {
      return; // Already connected
    }

    const source = this.#context.createMediaElementSource(player.element);
    const gain = this.#context.createGain();
    gain.gain.value = 0;

    source.connect(gain);
    gain.connect(this.#context.destination);

    this.#connections.set(player.id, { source, gain });
  }

  /**
   * Disconnect an HTML5 audio player from the Web Audio graph
   */
  disconnect(playerId: string): void {
    const connection = this.#connections.get(playerId);
    if (connection) {
      connection.source.disconnect();
      connection.gain.disconnect();
      this.#connections.delete(playerId);
    }
  }

  /**
   * Set the gain for a player immediately
   */
  setGain(playerId: string, value: number): void {
    const connection = this.#connections.get(playerId);
    if (connection) {
      connection.gain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  /**
   * Perform a crossfade from one player to another
   */
  async crossfade(
    outgoing: HTML5AudioPlayer | null,
    incoming: HTML5AudioPlayer,
    config: CrossfadeConfig
  ): Promise<void> {
    const { duration, targetVolume } = config;
    const durationSec = duration / 1000;
    const currentTime = this.#context.currentTime;

    // Ensure incoming is connected
    if (!this.#connections.has(incoming.id)) {
      this.connect(incoming);
    }

    const incomingConnection = this.#connections.get(incoming.id);
    if (!incomingConnection) {
      return;
    }

    // Start incoming at 0 and ramp up
    incomingConnection.gain.gain.setValueAtTime(0, currentTime);
    incomingConnection.gain.gain.linearRampToValueAtTime(
      targetVolume,
      currentTime + durationSec
    );

    // Fade out outgoing if present
    if (outgoing) {
      const outgoingConnection = this.#connections.get(outgoing.id);
      if (outgoingConnection) {
        outgoingConnection.gain.gain.setValueAtTime(
          outgoingConnection.gain.gain.value,
          currentTime
        );
        outgoingConnection.gain.gain.linearRampToValueAtTime(
          0,
          currentTime + durationSec
        );
      }
    }

    // Wait for crossfade to complete
    await new Promise((resolve) => setTimeout(resolve, duration));

    // Stop outgoing playback
    if (outgoing) {
      outgoing.stop();
      this.disconnect(outgoing.id);
    }
  }

  /**
   * Clean up all connections
   */
  dispose(): void {
    for (const [playerId] of this.#connections) {
      this.disconnect(playerId);
    }
  }
}

/**
 * Get or create the shared AudioContext for crossfading
 */
let sharedContext: AudioContext | null = null;

export function getCrossfadeContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

/**
 * Resume the shared AudioContext (call on user gesture)
 */
export async function resumeCrossfadeContext(): Promise<void> {
  const context = getCrossfadeContext();
  if (context.state === "suspended") {
    await context.resume();
  }
}
