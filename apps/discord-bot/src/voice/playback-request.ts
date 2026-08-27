import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { GuildMember } from "discord.js";
import { nowPlayingEmbed } from "../lib/embeds.js";
import { startGuildPlayback } from "./guild-player.js";
import type { QueueTrack } from "./queue.js";

type PlaybackInteraction =
  | ChatInputCommandInteraction
  | StringSelectMenuInteraction;

type PlaybackRequestMessages = {
  voiceChannelRequired: string;
  failurePrefix: string;
  serverRequired?: string;
  noPlayableTracks?: string;
};

type PlaybackRequestOptions = {
  messages: PlaybackRequestMessages;
  beforeDefer?: () => boolean | Promise<boolean>;
  loadTracks: (
    requestedBy: string
  ) => QueueTrack | QueueTrack[] | Promise<QueueTrack | QueueTrack[]>;
};

export type PlaybackRequestResult =
  | { status: "played"; firstTrack: QueueTrack; trackCount: number }
  | { status: "no-playable-tracks" }
  | { status: "missing-voice-channel" }
  | { status: "missing-guild" }
  | { status: "handled-before-defer" }
  | { status: "failed"; message: string };

export async function requestPlayback(
  interaction: PlaybackInteraction,
  options: PlaybackRequestOptions
): Promise<PlaybackRequestResult> {
  if (!interaction.guildId) {
    if (options.messages.serverRequired) {
      await interaction.reply({
        content: options.messages.serverRequired,
        ephemeral: true,
      });
    }
    return { status: "missing-guild" };
  }

  const { member } = interaction;

  if (!(member instanceof GuildMember && member.voice.channel)) {
    await interaction.reply({
      content: options.messages.voiceChannelRequired,
      ephemeral: true,
    });
    return { status: "missing-voice-channel" };
  }

  if (options.beforeDefer && !(await options.beforeDefer())) {
    return { status: "handled-before-defer" };
  }

  await interaction.deferReply();

  try {
    const loadedTracks = await options.loadTracks(interaction.user.displayName);
    const tracks = Array.isArray(loadedTracks) ? loadedTracks : [loadedTracks];
    const firstTrack = await startGuildPlayback({
      guildId: interaction.guildId,
      tracks,
      voiceChannel: member.voice.channel,
    });

    if (!firstTrack) {
      await interaction.editReply({
        content:
          options.messages.noPlayableTracks ?? "No playable tracks found.",
      });
      return { status: "no-playable-tracks" };
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

    return { firstTrack, status: "played", trackCount: tracks.length };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    await interaction.editReply({
      content: `${options.messages.failurePrefix}: ${message}`,
    });
    return { message, status: "failed" };
  }
}
