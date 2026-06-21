import type { VoiceState } from "discord.js";
import { updateGuildVoiceOccupancy } from "../voice/guild-player.js";

export function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState
): void {
  const seenChannelIds = new Set<string>();

  for (const channel of [oldState.channel, newState.channel]) {
    if (!channel || seenChannelIds.has(channel.id)) {
      continue;
    }

    seenChannelIds.add(channel.id);
    const members = channel.members.filter((m) => !m.user.bot);
    updateGuildVoiceOccupancy({
      guildId: channel.guild.id,
      voiceChannel: channel,
      nonBotMemberCount: members.size,
    });
  }
}
