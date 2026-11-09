import type { Radio } from "@/lib/audio";
import { stationIntake } from "./external-station-workflow";

function streamName(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** A pasted stream becomes a temporary station named after its host. */
export async function loadStreamStation(
  url: string,
  {
    createSession = stationIntake.createSession,
    isCurrent,
  }: {
    createSession?: typeof stationIntake.createSession;
    isCurrent?: () => boolean;
  } = {}
): Promise<{ radio: Radio } | { error: string }> {
  const result = await createSession(
    {
      fields: { name: streamName(url), streamUrl: url },
      origin: "manual",
    },
    { isCurrent }
  );
  if (!result.ok) {
    return { error: result.error.message };
  }
  const { radio } = result.data;
  // The session record is keyed by name when the radio has no id.
  return { radio: { ...radio, id: radio.id ?? radio.name } };
}
