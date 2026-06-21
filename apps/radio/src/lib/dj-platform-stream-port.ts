import type { Radio } from "@/lib/audio";
import { youtubeResolveStream } from "@/utils/youtube.functions";

type PlatformStreamResolutionInput = {
  platform: "youtube";
  reason: "initial-load" | "playlist-next" | "stream-refresh";
  videoId: string;
  radio: Radio;
};

export async function resolveDjPlatformStreamUrl(
  input: PlatformStreamResolutionInput
): Promise<string | null> {
  switch (input.platform) {
    case "youtube": {
      const result = await youtubeResolveStream({
        data: { videoId: input.videoId },
      });
      if (!result.ok) {
        return null;
      }
      return result.data.stream?.streamUrl ?? null;
    }
    default:
      return null;
  }
}

export type { PlatformStreamResolutionInput };
