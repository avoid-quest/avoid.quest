export type WerkstattRuntimeStatus =
  | { state: "idle"; message: string }
  | { state: "compiling"; message: string }
  | { state: "ready"; message: string }
  | { state: "error"; message: string };

const IDLE_STATUS: WerkstattRuntimeStatus = {
  message: "Play a deck to start the openDAW runtime.",
  state: "idle",
};

const listeners = new Map<string, Set<() => void>>();
const statuses = new Map<string, WerkstattRuntimeStatus>();

export function getWerkstattRuntimeStatus(
  effectId: string
): WerkstattRuntimeStatus {
  return statuses.get(effectId) ?? IDLE_STATUS;
}

export function setWerkstattRuntimeStatus(
  effectId: string,
  status: WerkstattRuntimeStatus
): void {
  statuses.set(effectId, status);
  for (const listener of listeners.get(effectId) ?? []) {
    listener();
  }
}

export function clearWerkstattRuntimeStatus(effectId: string): void {
  statuses.delete(effectId);
  for (const listener of listeners.get(effectId) ?? []) {
    listener();
  }
}

export function subscribeWerkstattRuntimeStatus(
  effectId: string,
  listener: () => void
): () => void {
  const effectListeners = listeners.get(effectId) ?? new Set();
  effectListeners.add(listener);
  listeners.set(effectId, effectListeners);
  return () => {
    effectListeners.delete(listener);
    if (effectListeners.size === 0) {
      listeners.delete(effectId);
    }
  };
}
