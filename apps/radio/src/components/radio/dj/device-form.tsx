// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@avoid.quest/ui/components/alert";
import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { MicIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAudioDevices } from "@/lib/audio";

type DeviceFormProps = {
  onLoad: (deviceId: string, deviceLabel: string) => void;
  onCancel?: () => void;
};

export function DeviceForm({ onLoad, onCancel }: DeviceFormProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const {
    inputDevices,
    permissionState,
    isLoading,
    requestPermission,
    refreshDevices,
  } = useAudioDevices();

  // Filter out devices with empty deviceId (browser placeholder entries)
  const validDevices = inputDevices.filter((d) => d.deviceId);

  // Auto-select first device when devices become available
  useEffect(() => {
    if (validDevices.length > 0) {
      setSelectedDeviceId((prev) => prev ?? validDevices[0]?.deviceId ?? null);
    }
  }, [validDevices]);

  const handleLoad = () => {
    if (selectedDeviceId) {
      const device = validDevices.find((d) => d.deviceId === selectedDeviceId);
      onLoad(selectedDeviceId, device?.label ?? "Audio input");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-2">
      {permissionState === "denied" && (
        <Alert variant="destructive">
          <ShieldAlertIcon />
          <AlertTitle>Microphone access denied</AlertTitle>
          <AlertDescription>
            Allow microphone access in your browser settings, then reload.
          </AlertDescription>
        </Alert>
      )}
      {permissionState !== "granted" && permissionState !== "denied" && (
        <Alert>
          <MicIcon />
          <AlertDescription>
            <p>Grant microphone access to see your input devices by name.</p>
            <Button
              className="h-7 text-xs"
              disabled={isLoading}
              onClick={requestPermission}
              size="sm"
              variant="outline"
            >
              {isLoading ? <Spinner /> : <MicIcon />}
              {isLoading ? "Requesting…" : "Grant access"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {validDevices.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            disabled={isLoading}
            onValueChange={setSelectedDeviceId}
            value={selectedDeviceId ?? undefined}
          >
            <SelectTrigger
              aria-label="Audio input"
              className="min-w-0 flex-1"
              size="xs"
            >
              <SelectValue placeholder="Choose an input" />
            </SelectTrigger>
            <SelectContent>
              {validDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            aria-label="Refresh devices"
            className="size-7"
            disabled={isLoading}
            onClick={refreshDevices}
            size="icon"
            variant="ghost"
          >
            <RefreshCwIcon className={isLoading ? "animate-spin" : undefined} />
          </Button>
        </div>
      )}

      <div className="mt-auto flex justify-end gap-2 border-border/50 border-t pt-2">
        {onCancel ? (
          <Button
            className="h-7 text-xs"
            disabled={isLoading}
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        ) : null}
        {validDevices.length > 0 && (
          <Button
            className="h-7 text-xs"
            disabled={isLoading || !selectedDeviceId}
            onClick={handleLoad}
            size="sm"
          >
            Load input
          </Button>
        )}
      </div>
    </div>
  );
}
