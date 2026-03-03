import { EmbedBuilder } from "discord.js";
import type { QueueTrack } from "../voice/queue.js";
import type { PresetRadio } from "./presets.js";

const PLATFORM_COLORS: Record<string, number> = {
  bandcamp: 0x1d_a0_c3,
  soundcloud: 0xff_55_00,
  youtube: 0xff_00_00,
  radiogarden: 0x00_c8_53,
  "static-audio": 0x80_80_80,
};

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function nowPlayingEmbed(track: QueueTrack): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(track.title)
    .setColor(PLATFORM_COLORS[track.platform] ?? 0x58_65_f2)
    .addFields(
      { name: "Artist", value: track.artist, inline: true },
      { name: "Platform", value: track.platform, inline: true }
    );

  if (track.isLiveStream) {
    embed.addFields({ name: "Duration", value: "LIVE", inline: true });
  } else if (track.duration) {
    embed.addFields({
      name: "Duration",
      value: formatDuration(track.duration),
      inline: true,
    });
  }

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  if (track.url) {
    embed.setURL(track.url);
  }

  embed.setFooter({ text: `Requested by ${track.requestedBy}` });

  return embed;
}

export function queueEmbed(
  tracks: readonly QueueTrack[],
  currentIndex: number
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("Queue").setColor(0x58_65_f2);

  if (tracks.length === 0) {
    embed.setDescription("The queue is empty.");
    return embed;
  }

  const lines = tracks.slice(0, 20).map((track, i) => {
    const prefix = i === currentIndex ? "**>**" : `${i + 1}.`;
    let duration = "?:??";
    if (track.isLiveStream) {
      duration = "LIVE";
    } else if (track.duration) {
      duration = formatDuration(track.duration);
    }
    return `${prefix} ${track.title} — ${track.artist} [${duration}]`;
  });

  if (tracks.length > 20) {
    lines.push(`... and ${tracks.length - 20} more`);
  }

  embed.setDescription(lines.join("\n"));
  embed.setFooter({
    text: `${tracks.length} track${tracks.length === 1 ? "" : "s"} in queue`,
  });

  return embed;
}

export function presetListEmbed(presetRadios: PresetRadio[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Radio Stations")
    .setColor(0x00_c8_53)
    .setDescription("Use `/radio <name>` to play a station.");

  for (const radio of presetRadios) {
    embed.addFields({
      name: radio.name,
      value: radio.description,
      inline: false,
    });
  }

  return embed;
}
