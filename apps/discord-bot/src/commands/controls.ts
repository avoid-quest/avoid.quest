import type { ChatInputCommandInteraction } from "discord.js";
import { SlashCommandBuilder } from "discord.js";
import { destroyGuildPlayer, getGuildPlayer } from "../voice/guild-player.js";

export const pause = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause playback"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = interaction.guildId
      ? getGuildPlayer(interaction.guildId)
      : null;
    if (!player?.isPlaying) {
      await interaction.reply({ content: "Nothing is playing." });
      return;
    }
    player.pause();
    await interaction.reply({ content: "Paused." });
  },
};

export const resume = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume playback"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = interaction.guildId
      ? getGuildPlayer(interaction.guildId)
      : null;
    if (!player?.isPaused) {
      await interaction.reply({ content: "Nothing is paused." });
      return;
    }
    player.resume();
    await interaction.reply({ content: "Resumed." });
  },
};

export const stop = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }
    const player = getGuildPlayer(interaction.guildId);
    if (!player) {
      await interaction.reply({ content: "Nothing is playing." });
      return;
    }
    destroyGuildPlayer(interaction.guildId);
    await interaction.reply({ content: "Stopped and disconnected." });
  },
};

export const volume = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .addIntegerOption((option) =>
      option
        .setName("percent")
        .setDescription("Volume level (0-100)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = interaction.guildId
      ? getGuildPlayer(interaction.guildId)
      : null;
    if (!player) {
      await interaction.reply({ content: "Nothing is playing." });
      return;
    }
    const percent = interaction.options.getInteger("percent", true);
    player.setVolume(percent);
    await interaction.reply({ content: `Volume set to ${percent}%.` });
  },
};

export const clear = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear the queue"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = interaction.guildId
      ? getGuildPlayer(interaction.guildId)
      : null;
    if (!player) {
      await interaction.reply({ content: "Nothing is playing." });
      return;
    }
    player.stop();
    await interaction.reply({ content: "Queue cleared." });
  },
};
