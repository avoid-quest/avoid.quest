/**
 * Player Mode Normalisation
 *
 * The modes the app offers are Single, Node and DJ. Node replaced Multiple,
 * so a stored or synced "multiple" maps to "node", and anything else unknown
 * falls back to "single".
 */

export const PLAYER_MODES = ["single", "node", "dj"] as const;
export type PlayerMode = (typeof PLAYER_MODES)[number];

export function isPlayerMode(mode: unknown): mode is PlayerMode {
  return PLAYER_MODES.some((playerMode) => playerMode === mode);
}

export function normalizePlayerMode(mode: unknown): PlayerMode {
  if (mode === "multiple") {
    return "node";
  }
  return isPlayerMode(mode) ? mode : "single";
}
