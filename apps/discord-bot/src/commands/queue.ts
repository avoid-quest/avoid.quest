import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { queueEmbed } from "../lib/embeds.js";
import { getGuildPlayer } from "../voice/guild-player.js";

export const data = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show the current queue");

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

  if (!player || player.queue.isEmpty) {
    await interaction.reply({ content: "The queue is empty." });
    return;
  }

  await interaction.reply({
    embeds: [queueEmbed(player.queue.items, 0)],
  });
}
