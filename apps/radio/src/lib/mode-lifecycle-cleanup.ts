import type { PlaybackActionContext } from "@/lib/playback-action-context";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

export function getRuntimeSoundIds(channelIds: readonly string[]): string[] {
  return channelIds.flatMap((channelId) => {
    const soundId = getPlaybackChannelRuntime(channelId).soundId;
    return soundId ? [soundId] : [];
  });
}

export function cleanupOrphanedSounds(
  soundIds: readonly string[],
  ctx: PlaybackActionContext,
  ownerLabel: string
): void {
  const orphanedSoundIds = soundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  for (const soundId of orphanedSoundIds) {
    ctx.audio.cleanupSound(soundId);
  }
  const remainingSoundIds = orphanedSoundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  if (remainingSoundIds.length > 0) {
    throw new Error(
      `Orphaned ${ownerLabel} sounds after deactivation: ${remainingSoundIds.join(
        ", "
      )}`
    );
  }
}
