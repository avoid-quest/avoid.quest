/**
 * React hook for MIDI controller initialization.
 *
 * Initializes MidiController on mount, registers static actions,
 * and syncs the mappingsByKey index from the store to the controller.
 */

import { useEffect } from "react";
import {
  MidiController,
  registerStaticActions,
  useMidiStore,
} from "@/lib/midi";

export function useMidi(): void {
  // Initialize MIDI controller and register static actions on mount
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.requestMIDIAccess) {
      useMidiStore.getState().setIsSupported(false);
      return;
    }

    useMidiStore.getState().setIsSupported(true);

    const controller = MidiController.getInstance();

    // Register static MIDI actions (decks + mixer)
    const unregisterStatic = registerStaticActions();

    controller.init().then((success) => {
      if (success) {
        useMidiStore.getState().setDevices(controller.getDevices());
      }
    });

    return () => {
      unregisterStatic();
      controller.cleanup();
    };
  }, []);

  // Sync mappingsByKey Map from store to controller
  const mappingsByKey = useMidiStore((s) => s.mappingsByKey);
  const enabled = useMidiStore((s) => s.enabled);

  useEffect(() => {
    const controller = MidiController.getInstance();
    if (enabled) {
      controller.setMappings(mappingsByKey);
    } else {
      controller.setMappings(new Map());
    }
  }, [mappingsByKey, enabled]);
}
