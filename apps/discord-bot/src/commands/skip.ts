import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { nowPlayingEmbed } from "../lib/embeds.js";
import { getGuildPlayer } from "../voice/guild-player.js";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current track");

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

  if (!player?.isActive) {
    await interaction.reply({ content: "Nothing is playing." });
    return;
  }

  const next = player.skip();

  if (next) {
    await interaction.reply({
      content: "Skipped. Now playing:",
      embeds: [nowPlayingEmbed(next)],
    });
  } else {
    await interaction.reply({ content: "Skipped. Queue is now empty." });
  }
}
