import type { ChatInputCommandInteraction } from "discord.js";
import { GuildMember, SlashCommandBuilder } from "discord.js";
import { nowPlayingEmbed, presetListEmbed } from "../lib/embeds.js";
import { presets } from "../lib/presets.js";
import { getOrCreateGuildPlayer } from "../voice/guild-player.js";
import type { QueueTrack } from "../voice/queue.js";

export const data = new SlashCommandBuilder()
  .setName("radio")
  .setDescription("Play a preset radio station")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("Station name (leave empty to see all stations)")
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const name = interaction.options.getString("name");

  if (!name) {
    await interaction.reply({ embeds: [presetListEmbed(presets)] });
    return;
  }

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

  const query = name.toLowerCase();
  const station = presets.find(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      query.includes(p.name.toLowerCase())
  );

  if (!station) {
    await interaction.reply({
      content: `No station found matching "${name}". Use \`/radio\` to see available stations.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const player = getOrCreateGuildPlayer(interaction.guildId);

    if (!player.isConnected) {
      await player.join(member.voice.channel);
    }

    const track: QueueTrack = {
      title: station.name,
      artist: station.description,
      url: station.websiteUrl,
      streamUrl: station.streamUrl,
      platform: "radio",
      requestedBy: interaction.user.displayName,
      isLiveStream: true,
      thumbnail: station.logoUrl,
    };

    player.stop();
    player.queue.add(track);
    await player.play(track);

    await interaction.editReply({
      embeds: [nowPlayingEmbed(track)],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    await interaction.editReply({
      content: `Failed to play station: ${message}`,
    });
  }
}
