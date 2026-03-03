import type { VoiceState } from "discord.js";
import { getGuildPlayer } from "../voice/guild-player.js";

export function handleVoiceStateUpdate(
  oldState: VoiceState,
  _newState: VoiceState
): void {
  if (!oldState.channel) {
    return;
  }

  const guildId = oldState.guild.id;
  const player = getGuildPlayer(guildId);
  if (!player) {
    return;
  }

  const members = oldState.channel.members.filter((m) => !m.user.bot);
  if (members.size === 0) {
    player.startDisconnectTimer();
  } else {
    player.clearDisconnectTimer();
  }
}
