import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { nowPlayingEmbed } from "../lib/embeds.js";
import { getGuildPlayer } from "../voice/guild-player.js";

export const data = new SlashCommandBuilder()
  .setName("nowplaying")
  .setDescription("Show the currently playing track");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const player = getGuildPlayer(interaction.guildId);
  const track = player?.currentTrack;

  if (!track) {
    await interaction.reply({ content: "Nothing is playing." });
    return;
  }

  await interaction.reply({ embeds: [nowPlayingEmbed(track)] });
}
