import {
  type AudioPlayer,
  AudioPlayerStatus,
  type AudioResource,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import type { QueueTrack } from "./queue.js";
import { TrackQueue } from "./queue.js";
import {
  configureStereoEncoder,
  patchConnectionForStereo,
} from "./stereo-patch.js";
import { resolveYouTubeStreamUrl } from "./stream-resolver.js";

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for swallowed promise rejections
function noop() {}

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
  private channel: VoiceBasedChannel | null = null;
  private readonly player: AudioPlayer;
  private volume = 0.5;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private skipping = false;
  private playId = 0;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.skipping) {
        return;
      }
      const current = this.queue.current;
      if (current?.isLiveStream) {
        return;
      }
      this.updateVoiceStatus("");
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

  get isActive(): boolean {
    const s = this.player.state.status;
    return (
      s === AudioPlayerStatus.Playing ||
      s === AudioPlayerStatus.Buffering ||
      s === AudioPlayerStatus.Paused
    );
  }

  get currentTrack(): QueueTrack | null {
    return this.queue.current;
  }

  async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection) {
      this.connection.destroy();
    }

    this.channel = channel;
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

    patchConnectionForStereo(this.connection);

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
    const id = ++this.playId;
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

    if (id !== this.playId) {
      return;
    }

    const resource = createAudioResource(streamUrl, {
      inlineVolume: true,
    });

    configureStereoEncoder(resource);

    resource.volume?.setVolume(this.volume);
    this.player.play(resource);

    const status =
      track.artist && !track.isLiveStream
        ? `${track.title} — ${track.artist}`
        : track.title;
    this.updateVoiceStatus(status.slice(0, 128));
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
    this.skipping = true;
    const next = this.queue.next();
    this.player.stop();
    this.skipping = false;
    if (next) {
      this.play(next).catch((err) => {
        console.error("[GuildPlayer] Skip play failed:", err);
        this.playNext();
      });
    } else {
      this.updateVoiceStatus("");
    }
    return next;
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  playResource(resource: AudioResource): void {
    this.player.play(resource);
  }

  stop(): void {
    this.queue.clear();
    this.player.stop();
    this.updateVoiceStatus("");
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
    this.updateVoiceStatus("");
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = null;
    this.channel = null;
    this.queue.clear();
  }

  private updateVoiceStatus(status: string): void {
    if (!this.channel) {
      return;
    }
    this.channel.client.rest
      .put(`/channels/${this.channel.id}/voice-status`, {
        body: { status },
      })
      .catch(noop);
  }
}
