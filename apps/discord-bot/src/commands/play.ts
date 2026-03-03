import type { ChatInputCommandInteraction } from "discord.js";
import { GuildMember, SlashCommandBuilder } from "discord.js";
import { nowPlayingEmbed } from "../lib/embeds.js";
import { getOrCreateGuildPlayer } from "../voice/guild-player.js";
import { resolveTrack } from "../voice/stream-resolver.js";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a track from a URL")
  .addStringOption((option) =>
    option
      .setName("url")
      .setDescription(
        "Bandcamp, SoundCloud, YouTube, Radio Garden, or direct audio URL"
      )
      .setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const url = interaction.options.getString("url", true);
  const member = interaction.member;

  if (!(member instanceof GuildMember && member.voice.channel)) {
    await interaction.reply({
      content: "You need to be in a voice channel to use this command.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const result = await resolveTrack(url, interaction.user.displayName);
    const player = getOrCreateGuildPlayer(interaction.guildId);

    if (!player.isConnected) {
      await player.join(member.voice.channel);
    }

    const tracks = Array.isArray(result) ? result : [result];
    const firstTrack = await player.enqueue(tracks);

    if (!firstTrack) {
      await interaction.editReply({ content: "No playable tracks found." });
      return;
    }

    if (tracks.length > 1) {
      await interaction.editReply({
        content: `Added ${tracks.length} tracks to the queue.`,
        embeds: [nowPlayingEmbed(firstTrack)],
      });
    } else {
      await interaction.editReply({
        embeds: [nowPlayingEmbed(firstTrack)],
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    await interaction.editReply({ content: `Failed to play: ${message}` });
  }
}
