/**
 * useAudioDevices hook
 *
 * Shared logic for enumerating audio devices, requesting permissions,
 * and listening for device hot-plug events.
 */

import { useCallback, useEffect, useState } from "react";
import type { AudioDeviceInfo } from "../playback/device-source.js";
import { DeviceSource } from "../playback/device-source.js";

type PermissionState = "prompt" | "granted" | "denied" | "error";

type UseAudioDevicesOptions = {
  /** Only load devices when this is true (e.g., when a dialog is open) */
  enabled?: boolean;
  /**
   * Also ask the Permissions API where the mic stands, so a blocked mic
   * reads as denied before anything is requested, and follow its changes.
   */
  queryPermission?: boolean;
};

type UseAudioDevicesReturn = {
  inputDevices: AudioDeviceInfo[];
  outputDevices: AudioDeviceInfo[];
  permissionState: PermissionState;
  isLoading: boolean;
  requestPermission: () => Promise<void>;
  refreshDevices: () => Promise<void>;
};

export function useAudioDevices(
  options: UseAudioDevicesOptions = {}
): UseAudioDevicesReturn {
  const { enabled = true, queryPermission = false } = options;

  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("prompt");
  const [isLoading, setIsLoading] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const [inputs, outputs] = await Promise.all([
        DeviceSource.getInputDevices(),
        DeviceSource.getOutputDevices(),
      ]);
      setInputDevices(inputs);
      setOutputDevices(outputs);

      const hasRealLabels = [...inputs, ...outputs].some(
        (d) =>
          d.label &&
          !d.label.startsWith("Input ") &&
          !d.label.startsWith("Output ")
      );
      if (hasRealLabels) {
        setPermissionState("granted");
      }
    } catch (error) {
      console.warn("[useAudioDevices] Device enumeration failed:", error);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = await DeviceSource.requestPermission();
      setPermissionState(state);
      if (state === "granted") {
        await loadDevices();
      }
    } catch (error) {
      console.warn("[useAudioDevices] Permission request failed:", error);
      setPermissionState("error");
    } finally {
      setIsLoading(false);
    }
  }, [loadDevices]);

  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    await loadDevices();
    setIsLoading(false);
  }, [loadDevices]);

  // Load devices when enabled
  useEffect(() => {
    if (enabled) {
      loadDevices();
    }
  }, [enabled, loadDevices]);

  // Where the mic permission stands, and when the user changes it
  useEffect(() => {
    if (!(enabled && queryPermission)) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return;
    }
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const apply = () => {
      if (!status || cancelled) {
        return;
      }
      const { state } = status;
      setPermissionState(state);
      if (state === "granted") {
        loadDevices();
      }
    };
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        status = result;
        result.addEventListener("change", apply);
        apply();
      })
      .catch(() => {
        // Some browsers can't query the microphone permission.
      });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", apply);
    };
  }, [enabled, queryPermission, loadDevices]);

  // Listen for device changes (hot-plug)
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    const handler = () => loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [enabled, loadDevices]);

  return {
    inputDevices,
    isLoading,
    outputDevices,
    permissionState,
    refreshDevices,
    requestPermission,
  };
}
