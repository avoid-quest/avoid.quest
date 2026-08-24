import { useEffect, useSyncExternalStore } from "react";
import { getMidiControl, type MidiControlSnapshot } from "@/lib/midi";

export function useMidiControlSnapshot(): MidiControlSnapshot {
  const control = getMidiControl();
  return useSyncExternalStore(
    control.subscribe,
    control.getSnapshot,
    control.getSnapshot
  );
}

export function useMidiControlLifecycle(): void {
  useEffect(() => {
    const control = getMidiControl();
    control.start();
    return () => control.cleanup();
  }, []);
}

export function useMidi(): void {
  useEffect(() => getMidiControl().activateDj(), []);
}
