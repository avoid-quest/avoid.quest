import type { Radio } from "@/lib/audio";
import type { PlaybackSessionId } from "@/lib/collections/playback-sessions";
import { validateRadioForMode } from "@/lib/external-url/utils";

type ManagedPlaybackSessionId = Exclude<PlaybackSessionId, "dj">;

export type ManagedRestoreCandidate = {
  channelId: string;
  radio: Radio | null;
  soundId?: string | null;
};

export type ManagedRestoreAction =
  | {
      channelId: string;
      cleanupSound: boolean;
      type: "reset";
    }
  | {
      channelId: string;
      radio: Radio;
      type: "create";
    };

function isRestorableManagedRadio(
  radio: Radio | null,
  sessionId: ManagedPlaybackSessionId
): radio is Radio {
  if (!radio || radio.platformMetadata?.platform === "local-file") {
    return false;
  }

  try {
    validateRadioForMode(radio, sessionId);
    return true;
  } catch {
    return false;
  }
}

export function planManagedSessionRestore(
  sessionId: ManagedPlaybackSessionId,
  activeChannelId: string | null,
  candidates: readonly ManagedRestoreCandidate[]
): ManagedRestoreAction[] {
  const selectedCandidates =
    sessionId === "single"
      ? candidates.filter(({ channelId }) => channelId === activeChannelId)
      : candidates;

  const actions: ManagedRestoreAction[] = [];
  for (const { channelId, radio, soundId } of selectedCandidates) {
    if (!isRestorableManagedRadio(radio, sessionId)) {
      actions.push({
        channelId,
        cleanupSound: Boolean(soundId),
        type: "reset",
      });
      continue;
    }
    if (!soundId) {
      actions.push({ channelId, radio, type: "create" });
    }
  }
  return actions;
}

export function mergeMultiplePlaybackRadios(
  radios: Radio[],
  sessionRadios: Radio[]
): Radio[] {
  return [
    ...radios,
    ...sessionRadios.filter(
      (sessionRadio) => !radios.some((radio) => radio.id === sessionRadio.id)
    ),
  ];
}
