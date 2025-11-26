import { useEffect, useState } from "react";
import {
  getCurrentTrackIndex,
  isCollection,
} from "@/lib/external-url/metadata-helpers";
import type { Radio } from "@/lib/types";

export function usePlatformMetadata(radio: Radio | null) {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

  useEffect(() => {
    if (radio?.platformMetadata && radio.streamUrl) {
      const index = getCurrentTrackIndex(
        radio.platformMetadata,
        radio.streamUrl
      );
      setCurrentTrackIndex(index);
    } else {
      setCurrentTrackIndex(0);
    }
  }, [radio]);

  const isPlatformItem = !!radio?.platformMetadata;
  const isPlaylistOrAlbum = radio?.platformMetadata
    ? isCollection(radio.platformMetadata)
    : false;

  return {
    currentTrackIndex,
    metadata: radio?.platformMetadata,
    isPlatformItem,
    isCollection: isPlaylistOrAlbum,
  };
}
