import { Readable } from "node:stream";
import { createAudioResource, StreamType } from "@discordjs/voice";
import {
  type ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { getOrCreateGuildPlayer } from "../voice/guild-player.js";
import { configureStereoEncoder } from "../voice/stereo-patch.js";

export const data = new SlashCommandBuilder()
  .setName("stereotest")
  .setDescription("Play a stereo test tone (left/right alternating)");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member;
  if (!(member instanceof GuildMember && member.voice.channel)) {
    await interaction.reply({
      content: "You need to be in a voice channel.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    return;
  }

  await interaction.deferReply();

  const player = getOrCreateGuildPlayer(interaction.guildId);
  if (!player.isConnected) {
    await player.join(member.voice.channel);
  }

  // Generate 6 seconds of stereo test: L tone, R tone, L tone, R tone, L tone, R tone
  const sampleRate = 48_000;
  const secPerSide = 1;
  const samplesPerSide = sampleRate * secPerSide;
  const reps = 3;
  const totalFrames = samplesPerSide * 2 * reps; // L+R per rep
  const buf = Buffer.alloc(totalFrames * 4); // 4 bytes per stereo frame (s16le x 2ch)

  for (let rep = 0; rep < reps; rep++) {
    const baseOffset = rep * samplesPerSide * 2 * 4;
    // Left-only section
    for (let i = 0; i < samplesPerSide; i++) {
      const off = baseOffset + i * 4;
      const s = Math.floor(
        Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16_000
      );
      buf.writeInt16LE(s, off); // L
      buf.writeInt16LE(0, off + 2); // R silent
    }
    // Right-only section
    for (let i = 0; i < samplesPerSide; i++) {
      const off = baseOffset + samplesPerSide * 4 + i * 4;
      const s = Math.floor(
        Math.sin((2 * Math.PI * 554 * i) / sampleRate) * 16_000
      );
      buf.writeInt16LE(0, off); // L silent
      buf.writeInt16LE(s, off + 2); // R
    }
  }

  const stream = Readable.from(buf);
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  resource.volume?.setVolume(0.5);

  configureStereoEncoder(resource);

  player.stop();
  player.playResource(resource);

  await interaction.editReply(
    "Playing stereo test: L(440Hz) → R(554Hz), 3 cycles. Listen with headphones."
  );
}
