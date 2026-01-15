/**
 * HTML5 Audio Manager
 *
 * Manages multiple HTML5 audio players for "multiple" mode.
 * Simple manager without effects or complex routing.
 */

import type { Radio } from "../playback/types.js";
import { HTML5AudioPlayer } from "./html5-audio-player.js";
import type { HTML5AudioStateCallback } from "./types.js";

/**
 * Manager for multiple independent HTML5 audio players
 */
export class HTML5AudioManager {
  private static instance: HTML5AudioManager | null = null;

  readonly #players = new Map<string, HTML5AudioPlayer>();
  readonly #requestedVolumes = new Map<string, number>();
  #globalVolume = 1;
  #globalMuted = false;
  #lastGlobalVolume = 1;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): HTML5AudioManager {
    if (!HTML5AudioManager.instance) {
      HTML5AudioManager.instance = new HTML5AudioManager();
    }
    return HTML5AudioManager.instance;
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static resetInstance(): void {
    if (HTML5AudioManager.instance) {
      HTML5AudioManager.instance.dispose();
      HTML5AudioManager.instance = null;
    }
  }

  /**
   * Create a new player for a radio
   */
  createPlayer(radio: Radio, playerId?: string): string {
    const id = playerId ?? `player_${radio.id ?? Date.now()}`;

    // Clean up existing player
    if (this.#players.has(id)) {
      this.removePlayer(id);
    }

    const player = new HTML5AudioPlayer(id, radio);
    this.#players.set(id, player);
    this.#requestedVolumes.set(id, 1);

    return id;
  }

  /**
   * Get a player by ID
   */
  getPlayer(playerId: string): HTML5AudioPlayer | undefined {
    return this.#players.get(playerId);
  }

  /**
   * Remove a player
   */
  removePlayer(playerId: string): void {
    const player = this.#players.get(playerId);
    if (player) {
      player.dispose();
      this.#players.delete(playerId);
      this.#requestedVolumes.delete(playerId);
    }
  }

  /**
   * Play a player
   */
  async play(playerId: string, volume?: number): Promise<void> {
    const player = this.#players.get(playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }

    const requestedVolume = volume ?? this.#requestedVolumes.get(playerId) ?? 1;
    this.#requestedVolumes.set(playerId, requestedVolume);

    const effectiveVolume = requestedVolume * this.#globalVolume;
    await player.play(effectiveVolume);
  }

  /**
   * Pause a player
   */
  pause(playerId: string): void {
    const player = this.#players.get(playerId);
    player?.pause();
  }

  /**
   * Stop a player
   */
  stop(playerId: string): void {
    const player = this.#players.get(playerId);
    player?.stop();
  }

  /**
   * Set volume for a player
   */
  setVolume(playerId: string, volume: number): void {
    const player = this.#players.get(playerId);
    if (player) {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      this.#requestedVolumes.set(playerId, clampedVolume);
      player.setVolume(clampedVolume * this.#globalVolume);
    }
  }

  /**
   * Get global volume
   */
  getGlobalVolume(): number {
    return this.#globalVolume;
  }

  /**
   * Set global volume (affects all players)
   */
  setGlobalVolume(volume: number): void {
    this.#globalVolume = Math.max(0, Math.min(1, volume));

    // Update all players using their requested volumes
    for (const [playerId, player] of this.#players) {
      const requestedVolume = this.#requestedVolumes.get(playerId) ?? 1;
      player.setVolume(requestedVolume * this.#globalVolume);
    }
  }

  /**
   * Mute global audio
   */
  muteGlobal(): void {
    if (!this.#globalMuted) {
      this.#lastGlobalVolume = this.#globalVolume;
      this.#globalMuted = true;

      // Set all players to 0
      for (const player of this.#players.values()) {
        player.setVolume(0);
      }
    }
  }

  /**
   * Unmute global audio
   */
  unmuteGlobal(): void {
    if (this.#globalMuted) {
      this.#globalVolume = this.#lastGlobalVolume;
      this.#globalMuted = false;

      // Restore all players using their requested volumes
      for (const [playerId, player] of this.#players) {
        const requestedVolume = this.#requestedVolumes.get(playerId) ?? 1;
        player.setVolume(requestedVolume * this.#globalVolume);
      }
    }
  }

  /**
   * Check if global audio is muted
   */
  isGlobalMuted(): boolean {
    return this.#globalMuted;
  }

  /**
   * Subscribe to state changes for a player
   */
  subscribe(playerId: string, callback: HTML5AudioStateCallback): () => void {
    const player = this.#players.get(playerId);
    if (!player) {
      return () => {};
    }
    return player.subscribe(callback);
  }

  /**
   * Get all player IDs
   */
  getPlayerIds(): string[] {
    return Array.from(this.#players.keys());
  }

  /**
   * Get all players
   */
  getPlayers(): HTML5AudioPlayer[] {
    return Array.from(this.#players.values());
  }

  /**
   * Stop all players
   */
  stopAll(): void {
    for (const player of this.#players.values()) {
      player.stop();
    }
  }

  /**
   * Dispose of all players and clean up
   */
  dispose(): void {
    for (const player of this.#players.values()) {
      player.dispose();
    }
    this.#players.clear();
    this.#requestedVolumes.clear();
  }
}
