import type { Radio } from "@/lib/audio";
import {
  type FileAudioMetadata,
  revokeFileObjectUrl,
} from "@/lib/audio/file-metadata";
import type { DeckSide } from "@/lib/dj-actions-decks.js";
import { type DeviceInputMetadata, isFileMetadata } from "@/lib/platform-types";

export function createDeviceInputRadio(
  side: DeckSide,
  deviceId: string,
  deviceLabel: string
): Radio {
  const radioId = `device-input-${side}`;
  const platformMetadata: DeviceInputMetadata = {
    platform: "device-input",
    itemType: "track",
    url: "",
    deviceId,
    deviceLabel,
    channelSelection: { left: 0, right: 1 },
    channelCount: 2,
  };

  return {
    id: radioId,
    name: deviceLabel,
    streamUrl: "",
    description: "Device input (mic/line-in)",
    enabled: true,
    platformMetadata,
  };
}

export function createLocalFileRadio(
  side: DeckSide,
  metadata: FileAudioMetadata
): Radio {
  return {
    id: `local-file-${side}-${Date.now()}`,
    name: metadata.displayName,
    streamUrl: metadata.objectUrl,
    description: "Local File",
    enabled: true,
    platformMetadata: {
      platform: "local-file",
      itemType: "track",
      url: "",
      fileName: metadata.fileName,
      displayName: metadata.displayName,
      duration: metadata.duration,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType,
      objectUrl: metadata.objectUrl,
    },
  };
}

export function getLocalFileObjectUrl(radio: Radio | null): string | null {
  const metadata = radio?.platformMetadata;
  if (!isFileMetadata(metadata)) {
    return null;
  }
  return metadata.objectUrl;
}

export function releaseReplacedLocalFileUrl(
  previousRadio: Radio | null,
  nextRadio: Radio | null
): boolean {
  const previousObjectUrl = getLocalFileObjectUrl(previousRadio);
  const nextObjectUrl = getLocalFileObjectUrl(nextRadio);
  if (!previousObjectUrl || previousObjectUrl === nextObjectUrl) {
    return false;
  }
  revokeFileObjectUrl(previousObjectUrl);
  return true;
}
