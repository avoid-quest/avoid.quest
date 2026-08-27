import {
  type AudioPlayer,
  type AudioPlayerState,
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
import {
  type DirectAudioStream,
  fetchDirectAudioStream,
} from "./direct-audio.js";
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

export type GuildPlaybackSnapshot = {
  currentTrack: QueueTrack | null;
  queueTracks: readonly QueueTrack[];
};

export type PausePlaybackResult =
  | { status: "paused" }
  | { status: "not-playing" };

export type ResumePlaybackResult =
  | { status: "resumed" }
  | { status: "not-paused" };

export type StopPlaybackResult =
  | { status: "stopped" }
  | { status: "not-playing" };

export type ClearPlaybackResult =
  | { status: "cleared" }
  | { status: "not-playing" };

export type SkipPlaybackResult =
  | { status: "playing-next"; track: QueueTrack }
  | { status: "queue-empty" }
  | { status: "not-playing" };

export type SetVolumeResult =
  | { status: "volume-set"; percent: number }
  | { status: "not-playing" };

export type OccupancyResult =
  | { status: "disconnect-scheduled" }
  | { status: "disconnect-cleared" }
  | { status: "not-playing" };

function getGuildPlayer(guildId: string): GuildPlayer | undefined {
  return players.get(guildId);
}

function getOrCreateGuildPlayer(guildId: string): GuildPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = new GuildPlayer(guildId);
    players.set(guildId, player);
  }
  return player;
}

function destroyGuildPlayer(guildId: string): void {
  const player = players.get(guildId);
  if (player) {
    player.destroy();
    players.delete(guildId);
  }
}

export function getGuildPlaybackSnapshot(
  guildId: string
): GuildPlaybackSnapshot {
  const player = getGuildPlayer(guildId);
  return player?.getSnapshot() ?? { currentTrack: null, queueTracks: [] };
}

export function pauseGuildPlayback(guildId: string): PausePlaybackResult {
  return getGuildPlayer(guildId)?.pausePlayback() ?? { status: "not-playing" };
}

export function resumeGuildPlayback(guildId: string): ResumePlaybackResult {
  return getGuildPlayer(guildId)?.resumePlayback() ?? { status: "not-paused" };
}

export function stopGuildPlayback(guildId: string): StopPlaybackResult {
  if (!getGuildPlayer(guildId)) {
    return { status: "not-playing" };
  }

  destroyGuildPlayer(guildId);
  return { status: "stopped" };
}

export function clearGuildPlayback(guildId: string): ClearPlaybackResult {
  return getGuildPlayer(guildId)?.clearPlayback() ?? { status: "not-playing" };
}

export function skipGuildPlayback(guildId: string): SkipPlaybackResult {
  return getGuildPlayer(guildId)?.skipPlayback() ?? { status: "not-playing" };
}

export function setGuildPlaybackVolume(
  guildId: string,
  percent: number
): SetVolumeResult {
  return (
    getGuildPlayer(guildId)?.setPlaybackVolume(percent) ?? {
      status: "not-playing",
    }
  );
}

export function updateGuildVoiceOccupancy({
  guildId,
  voiceChannel,
  nonBotMemberCount,
}: {
  guildId: string;
  voiceChannel: VoiceBasedChannel;
  nonBotMemberCount: number;
}): OccupancyResult {
  const player = getGuildPlayer(guildId);
  return (
    player?.updateOccupancy(voiceChannel, nonBotMemberCount) ?? {
      status: "not-playing",
    }
  );
}

export function startGuildPlayback({
  guildId,
  voiceChannel,
  tracks,
}: {
  guildId: string;
  voiceChannel: VoiceBasedChannel;
  tracks: QueueTrack[];
}): Promise<QueueTrack | null> {
  const player = getOrCreateGuildPlayer(guildId);
  return player.startPlayback(voiceChannel, tracks);
}

export async function playGuildDiagnosticResource({
  guildId,
  voiceChannel,
  resource,
}: {
  guildId: string;
  voiceChannel: VoiceBasedChannel;
  resource: AudioResource;
}): Promise<void> {
  const player = getOrCreateGuildPlayer(guildId);
  await player.playDiagnosticResource(voiceChannel, resource);
}

class GuildPlayer {
  readonly guildId: string;
  private readonly queue = new TrackQueue();
  private connection: VoiceConnection | null = null;
  private channel: VoiceBasedChannel | null = null;
  private readonly player: AudioPlayer;
  private volume = 0.5;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activePlayAbortController: AbortController | null = null;
  private readonly ignoredIdleResources = new WeakSet<AudioResource>();
  private playId = 0;

  constructor(guildId: string) {
    this.guildId = guildId;
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, (oldState: AudioPlayerState) => {
      if (
        "resource" in oldState &&
        this.ignoredIdleResources.delete(oldState.resource)
      ) {
        return;
      }
      const { current } = this.queue;
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

  private get isConnected(): boolean {
    return this.connection !== null;
  }

  private get isPlaying(): boolean {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  private get isPaused(): boolean {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  private get isActive(): boolean {
    const s = this.player.state.status;
    return (
      s === AudioPlayerStatus.Playing ||
      s === AudioPlayerStatus.Buffering ||
      s === AudioPlayerStatus.Paused ||
      this.activePlayAbortController !== null
    );
  }

  private async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection) {
      this.connection.destroy();
    }

    this.channel = channel;
    this.connection = joinVoiceChannel({
      adapterCreator: channel.guild.voiceAdapterCreator,
      channelId: channel.id,
      guildId: channel.guild.id,
    });

    this.connection.subscribe(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      this.connection.destroy();
      this.connection = null;
      throw new Error("Failed to connect to voice channel within 20 seconds", {
        cause: error,
      });
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

  private async joinIfNeeded(channel: VoiceBasedChannel): Promise<void> {
    if (!this.isConnected) {
      await this.join(channel);
    }
  }

  getSnapshot(): GuildPlaybackSnapshot {
    return {
      currentTrack: this.queue.current,
      queueTracks: [...this.queue.items],
    };
  }

  private beginPlay(): { controller: AbortController; id: number } {
    this.abortActivePlay();
    const controller = new AbortController();
    this.playId += 1;
    const { playId: id } = this;
    this.activePlayAbortController = controller;
    return { controller, id };
  }

  private abortActivePlay(): void {
    this.activePlayAbortController?.abort();
    this.activePlayAbortController = null;
  }

  private invalidateActivePlay(): void {
    this.abortActivePlay();
    this.playId += 1;
  }

  private isCurrentPlay(id: number, controller: AbortController): boolean {
    return id === this.playId && this.activePlayAbortController === controller;
  }

  private finishPendingPlay(controller: AbortController): void {
    if (this.activePlayAbortController === controller) {
      this.activePlayAbortController = null;
    }
  }

  private async play(track: QueueTrack): Promise<void> {
    const { controller, id } = this.beginPlay();
    let { streamUrl } = track;
    let resourceInput: Parameters<typeof createAudioResource>[0] = streamUrl;
    let directAudio: DirectAudioStream | null = null;

    try {
      if (streamUrl.startsWith("yt:")) {
        const videoId = streamUrl.slice(3);
        const resolved = await resolveYouTubeStreamUrl(videoId);
        if (!this.isCurrentPlay(id, controller)) {
          return;
        }
        if (!resolved) {
          throw new Error(
            `Failed to resolve YouTube stream for video ${videoId}`
          );
        }
        streamUrl = resolved;
        track.streamUrl = resolved;
        resourceInput = resolved;
      }

      if (track.platform === "static-audio") {
        directAudio = await fetchDirectAudioStream(streamUrl, {
          signal: controller.signal,
        });
        streamUrl = directAudio.resolvedUrl;
        track.streamUrl = directAudio.resolvedUrl;
        resourceInput = directAudio.stream;
      }

      if (!this.isCurrentPlay(id, controller)) {
        directAudio?.stream.destroy();
        return;
      }

      const resource = createAudioResource(resourceInput, {
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
    } catch (error) {
      if (!this.isCurrentPlay(id, controller) || controller.signal.aborted) {
        return;
      }
      throw error;
    } finally {
      this.finishPendingPlay(controller);
    }
  }

  private async playNext(): Promise<boolean> {
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

  skipPlayback(): SkipPlaybackResult {
    if (!this.isActive) {
      return { status: "not-playing" };
    }

    const { state } = this.player;
    const skippedResource = "resource" in state ? state.resource : null;
    if (skippedResource) {
      this.ignoredIdleResources.add(skippedResource);
    }
    const next = this.queue.next();
    this.invalidateActivePlay();
    if (!this.player.stop() && skippedResource) {
      this.ignoredIdleResources.delete(skippedResource);
    }
    if (next) {
      this.play(next).catch((err) => {
        console.error("[GuildPlayer] Skip play failed:", err);
        this.playNext();
      });
    } else {
      this.updateVoiceStatus("");
    }
    return next
      ? { status: "playing-next", track: next }
      : { status: "queue-empty" };
  }

  pausePlayback(): PausePlaybackResult {
    if (!this.isPlaying) {
      return { status: "not-playing" };
    }

    this.player.pause();
    return { status: "paused" };
  }

  resumePlayback(): ResumePlaybackResult {
    if (!this.isPaused) {
      return { status: "not-paused" };
    }

    this.player.unpause();
    return { status: "resumed" };
  }

  async startPlayback(
    voiceChannel: VoiceBasedChannel,
    tracks: QueueTrack[]
  ): Promise<QueueTrack | null> {
    await this.joinIfNeeded(voiceChannel);
    return this.enqueue(tracks);
  }

  async playDiagnosticResource(
    voiceChannel: VoiceBasedChannel,
    resource: AudioResource
  ): Promise<void> {
    await this.joinIfNeeded(voiceChannel);
    this.clearPlayback();
    this.playResource(resource);
  }

  private playResource(resource: AudioResource): void {
    this.player.play(resource);
  }

  clearPlayback(): ClearPlaybackResult {
    this.invalidateActivePlay();
    this.queue.clear();
    this.player.stop();
    this.updateVoiceStatus("");
    return { status: "cleared" };
  }

  private async enqueue(tracks: QueueTrack[]): Promise<QueueTrack | null> {
    const [firstTrack] = tracks;
    if (!firstTrack) {
      return null;
    }

    this.player.stop(true);
    this.queue.replace(tracks);
    await this.play(firstTrack);
    return firstTrack;
  }

  setPlaybackVolume(percent: number): SetVolumeResult {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    const { resource } = this.player.state as {
      resource?: { volume?: { setVolume: (v: number) => void } };
    };
    resource?.volume?.setVolume(this.volume);
    return { percent, status: "volume-set" };
  }

  updateOccupancy(
    voiceChannel: VoiceBasedChannel,
    nonBotMemberCount: number
  ): OccupancyResult {
    const botUserId = voiceChannel.client.user?.id;
    if (!(botUserId && voiceChannel.members.has(botUserId))) {
      return { status: "not-playing" };
    }

    this.channel = voiceChannel;

    if (nonBotMemberCount === 0) {
      this.startDisconnectTimer();
      return { status: "disconnect-scheduled" };
    }

    this.clearDisconnectTimer();
    return { status: "disconnect-cleared" };
  }

  private startDisconnectTimer(ms = 5 * 60 * 1000): void {
    this.clearDisconnectTimer();
    this.disconnectTimer = setTimeout(() => {
      destroyGuildPlayer(this.guildId);
    }, ms);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  destroy(): void {
    this.clearDisconnectTimer();
    this.invalidateActivePlay();
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
