import type { VoiceState } from "discord.js";
import { updateGuildVoiceOccupancy } from "../voice/guild-player.js";

export function handleVoiceStateUpdate(
  oldState: VoiceState,
  _newState: VoiceState
): void {
  if (!oldState.channel) {
    return;
  }

  const members = oldState.channel.members.filter((m) => !m.user.bot);
  updateGuildVoiceOccupancy(oldState.guild.id, members.size);
}
