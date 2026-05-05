import { resolveStreamUrl } from "@avoid.quest/platforms";
import type { PlatformStreamResolutionInput } from "@/lib/dj-deck-continuation-workflow.js";

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
