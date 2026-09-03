import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { presetListEmbed } from "../lib/embeds.js";
import { type PresetRadio, presets } from "../lib/presets.js";
import { requestPlayback } from "../voice/playback-request.js";
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

  let station: PresetRadio | undefined;

  await requestPlayback(interaction, {
    beforeDefer: async () => {
      const query = name.toLowerCase();
      station = presets.find(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          query.includes(p.name.toLowerCase())
      );

      if (!station) {
        await interaction.reply({
          content: `No station found matching "${name}". Use \`/radio\` to see available stations.`,
          ephemeral: true,
        });
        return false;
      }

      return true;
    },
    loadTracks: (requestedBy) => {
      if (!station) {
        throw new Error("No station selected");
      }

      const track: QueueTrack = {
        artist: station.description,
        isLiveStream: true,
        platform: "radio",
        requestedBy,
        streamUrl: station.streamUrl,
        thumbnail: station.logoUrl,
        title: station.name,
        url: station.websiteUrl,
      };

      return track;
    },
    messages: {
      failurePrefix: "Failed to play station",
      serverRequired: "This command can only be used in a server.",
      voiceChannelRequired:
        "You need to be in a voice channel to use this command.",
    },
  });
}
