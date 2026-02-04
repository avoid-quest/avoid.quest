/**
 * React hook for MIDI controller integration.
 *
 * Initializes MidiController on mount, syncs mappings from store,
 * and provides state and controls for the settings UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMidiPresetById,
  MidiController,
  type MidiDeviceInfo,
  useMidiStore,
} from "@/lib/midi";

export function useMidi() {
  const controllerRef = useRef<MidiController | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [isLearning, setIsLearning] = useState(false);
  const [learningTarget, setLearningTarget] = useState<string | null>(null);

  const {
    mappings,
    activePresetId,
    enabled,
    setMappings,
    addMapping,
    removeMapping,
    setActivePreset,
    setEnabled,
    reset,
  } = useMidiStore();

  // Initialize MIDI controller on mount
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.requestMIDIAccess) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const controller = MidiController.getInstance();
    controllerRef.current = controller;

    controller.setCallbacks({
      onDevicesChanged: (newDevices) => {
        setDevices(newDevices);
        setIsConnected(newDevices.some((d) => d.state === "connected"));
      },
      onLearnCapture: (partial) => {
        // The learn target is stored in the controller; we capture it before it's cleared
        const target = controller.learningTarget;
        if (target) {
          addMapping({ ...partial, actionId: target });
        }
        setIsLearning(false);
        setLearningTarget(null);
      },
    });

    controller.init().then((success) => {
      if (success) {
        const initialDevices = controller.getDevices();
        setDevices(initialDevices);
        setIsConnected(initialDevices.some((d) => d.state === "connected"));
      }
    });

    return () => {
      controller.cleanup();
      controllerRef.current = null;
    };
  }, [addMapping]);

  // Sync mappings from store to controller
  useEffect(() => {
    const controller = controllerRef.current;
    if (controller && enabled) {
      controller.setMappings(mappings);
    } else if (controller) {
      controller.setMappings([]);
    }
  }, [mappings, enabled]);

  const startLearn = useCallback((actionId: string) => {
    const controller = controllerRef.current;
    if (controller) {
      controller.startLearn(actionId);
      setIsLearning(true);
      setLearningTarget(actionId);
    }
  }, []);

  const stopLearn = useCallback(() => {
    const controller = controllerRef.current;
    if (controller) {
      controller.stopLearn();
    }
    setIsLearning(false);
    setLearningTarget(null);
  }, []);

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = getMidiPresetById(presetId);
      if (preset) {
        setMappings(preset.mappings);
        setActivePreset(presetId);
      }
    },
    [setMappings, setActivePreset]
  );

  const clearMappings = useCallback(() => {
    setMappings([]);
    setActivePreset(null);
  }, [setMappings, setActivePreset]);

  return {
    isSupported,
    isConnected,
    devices,
    mappings,
    activePresetId,
    isLearning,
    learningTarget,
    enabled,
    startLearn,
    stopLearn,
    loadPreset,
    clearMappings,
    removeMapping,
    setEnabled,
    reset,
  };
}
