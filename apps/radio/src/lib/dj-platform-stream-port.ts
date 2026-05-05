import { resolveStreamUrl } from "@avoid.quest/platforms";
import type { Radio } from "@/lib/audio";

type PlatformStreamResolutionInput = {
  platform: "youtube";
  reason: "playlist-next" | "stream-refresh";
  videoId: string;
  radio: Radio;
};

export async function resolveDjPlatformStreamUrl(
  input: PlatformStreamResolutionInput
): Promise<string | null> {
  switch (input.platform) {
    case "youtube":
      return await resolveStreamUrl(input.videoId);
    default:
      return null;
  }
}

export type { PlatformStreamResolutionInput };
