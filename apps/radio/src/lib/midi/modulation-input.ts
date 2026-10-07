/** Shared input bus; importing MIDI control does not load the Node canvas/runtime. */
const listeners = new Set<(bytes: Uint8Array) => void>();

export function publishModulationMidi(bytes: Uint8Array): void {
  for (const listener of listeners) {
    listener(bytes);
  }
}

export function resetModulationMidi(): void {
  publishModulationMidi(new Uint8Array([255]));
}

export function subscribeModulationMidi(
  listener: (bytes: Uint8Array) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
