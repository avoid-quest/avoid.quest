import { type AudioDeviceInfo, useAudioDevices } from "@/lib/audio";

/** A device as Node mode lists it: a real name, or "Input 1" until allowed. */
export type NodeDevice = { deviceId: string; label: string };

/** DeviceSource names a device it may not name yet "Input …" or "Output …". */
function isPlaceholder(label: string, prefix: string): boolean {
  return !label || label.startsWith(`${prefix} `);
}

/**
 * The devices with an id, named. Labels stay placeholders until the mic
 * is allowed, so those read "Input 1", "Output 2" by their place.
 */
export function nodeDevices(
  devices: readonly AudioDeviceInfo[],
  prefix: "Input" | "Output"
): NodeDevice[] {
  return devices
    .filter((device) => device.deviceId)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: isPlaceholder(device.label, prefix)
        ? `${prefix} ${index + 1}`
        : device.label,
    }));
}

/**
 * The browser's audio inputs and outputs for Node mode's device nodes and
 * palette, following hot-plug and where the mic permission stands.
 * `inputsListed` and `outputsListed` are true once a list holds real
 * device ids, so a device missing from it is truly unplugged.
 */
export function useNodeDevices({ enabled = true }: { enabled?: boolean } = {}) {
  const {
    inputDevices,
    outputDevices,
    permissionState,
    isLoading,
    requestPermission,
    refreshDevices,
  } = useAudioDevices({ enabled, queryPermission: true });
  const inputs = nodeDevices(inputDevices, "Input");
  const outputs = nodeDevices(outputDevices, "Output");
  const granted = permissionState === "granted";
  return {
    inputs,
    inputsListed: granted && inputs.length > 0,
    isLoading,
    outputs,
    outputsListed: granted && outputs.length > 0,
    permissionState,
    refreshDevices,
    requestPermission,
  };
}

export type NodeDevices = ReturnType<typeof useNodeDevices>;

/** Whether `deviceId` is gone from a list that would show it. */
export function isUnplugged(
  deviceId: string | null,
  devices: readonly NodeDevice[],
  listed: boolean
): boolean {
  return (
    deviceId !== null &&
    listed &&
    !devices.some((device) => device.deviceId === deviceId)
  );
}
