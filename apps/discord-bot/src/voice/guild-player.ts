import {
  type AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import type { QueueTrack } from "./queue.js";
import { TrackQueue } from "./queue.js";
import { resolveYouTubeStreamUrl } from "./stream-resolver.js";

const players = new Map<string, GuildPlayer>();

export function getGuildPlayer(guildId: string): GuildPlayer | undefined {
  return players.get(guildId);
}

export function getOrCreateGuildPlayer(guildId: string): GuildPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = new GuildPlayer(guildId);
    players.set(guildId, player);
  }
  return player;
}

export function destroyGuildPlayer(guildId: string): void {
  const player = players.get(guildId);
  if (player) {
    player.destroy();
    players.delete(guildId);
  }
}

export class GuildPlayer {
  readonly guildId: string;
  readonly queue = new TrackQueue();
  private connection: VoiceConnection | null = null;
  private readonly player: AudioPlayer;
  private volume = 0.5;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, () => {
      const current = this.queue.current;
      if (current?.isLiveStream) {
        return;
      }
      this.playNext();
    });

    this.player.on("error", (error) => {
      console.error(`[GuildPlayer ${guildId}] Audio error:`, error.message);
      this.playNext();
    });
  }

  get isConnected(): boolean {
    return this.connection !== null;
  }

  get isPlaying(): boolean {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  get isPaused(): boolean {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  get currentTrack(): QueueTrack | null {
    return this.queue.current;
  }

  async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection) {
      this.connection.destroy();
    }

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    this.connection.subscribe(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.connection.destroy();
      this.connection = null;
      throw new Error("Failed to connect to voice channel within 20 seconds");
    }

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!this.connection) {
        return;
      }
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        destroyGuildPlayer(this.guildId);
      }
    });

    this.clearDisconnectTimer();
  }

  async play(track: QueueTrack): Promise<void> {
    let { streamUrl } = track;

    if (streamUrl.startsWith("yt:")) {
      const videoId = streamUrl.slice(3);
      const resolved = await resolveYouTubeStreamUrl(videoId);
      if (!resolved) {
        throw new Error(
          `Failed to resolve YouTube stream for video ${videoId}`
        );
      }
      streamUrl = resolved;
      track.streamUrl = resolved;
    }

    const isOpus =
      streamUrl.includes("mime=audio%2Fwebm") ||
      streamUrl.includes("mime=audio/webm");

    const resource = createAudioResource(streamUrl, {
      inputType: isOpus ? StreamType.WebmOpus : StreamType.Arbitrary,
      inlineVolume: true,
    });

    resource.volume?.setVolume(this.volume);
    this.player.play(resource);
  }

  async playNext(): Promise<boolean> {
    const next = this.queue.next();
    if (!next) {
      return false;
    }

    try {
      await this.play(next);
      return true;
    } catch (error) {
      console.error(
        `[GuildPlayer ${this.guildId}] Failed to play next:`,
        error
      );
      return this.playNext();
    }
  }

  skip(): QueueTrack | null {
    this.player.stop();
    return this.queue.current;
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  stop(): void {
    this.queue.clear();
    this.player.stop();
  }

  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    const resource = (
      this.player.state as {
        resource?: { volume?: { setVolume: (v: number) => void } };
      }
    ).resource;
    resource?.volume?.setVolume(this.volume);
  }

  getVolume(): number {
    return Math.round(this.volume * 100);
  }

  startDisconnectTimer(ms = 5 * 60 * 1000): void {
    this.clearDisconnectTimer();
    this.disconnectTimer = setTimeout(() => {
      destroyGuildPlayer(this.guildId);
    }, ms);
  }

  clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  destroy(): void {
    this.clearDisconnectTimer();
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = null;
    this.queue.clear();
  }
}
