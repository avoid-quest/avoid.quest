import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { requestPlayback } from "../voice/playback-request.js";
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

  await requestPlayback(interaction, {
    messages: {
      voiceChannelRequired:
        "You need to be in a voice channel to use this command.",
      serverRequired: "This command can only be used in a server.",
      noPlayableTracks: "No playable tracks found.",
      failurePrefix: "Failed to play",
    },
    loadTracks: (requestedBy) => resolveTrack(url, requestedBy),
  });
}
