import type { Radio } from "@avoid.quest/cacophony";
import { useEffect, useState } from "react";
import {
  getCurrentTrackIndex,
  isCollection,
} from "@/lib/external-url/metadata-helpers";

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
