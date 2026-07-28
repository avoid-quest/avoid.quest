import { resolveRadioGardenStream } from "@/lib/platform-client";

export async function resolveRadioGardenStreamForWorkflow(
  channelId: string,
  canonicalUrl: string
) {
  try {
    const resolved = await resolveRadioGardenStream(channelId, canonicalUrl);
    return {
      data: { format: resolved.format, streamUrl: resolved.streamUrl },
      ok: true as const,
    };
  } catch (error) {
    return {
      error: {
        code: "RADIO_GARDEN_RESOLVER_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Failed to resolve Radio Garden stream",
      },
      ok: false as const,
    };
  }
}
