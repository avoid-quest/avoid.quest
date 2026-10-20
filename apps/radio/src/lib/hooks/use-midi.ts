import { useEffect, useSyncExternalStore } from "react";
import {
  getMidiControl,
  type MidiControlSnapshot,
  preloadMidiRuntime,
} from "@/lib/midi";

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
  useEffect(() => {
    preloadMidiRuntime().catch((error: unknown) => {
      console.error("[midi] Failed to prepare DJ controls:", error);
    });
    return getMidiControl().activateDj();
  }, []);
}
