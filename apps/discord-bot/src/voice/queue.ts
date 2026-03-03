export type QueueTrack = {
  title: string;
  artist: string;
  url: string;
  streamUrl: string;
  duration?: number;
  platform: string;
  thumbnail?: string;
  requestedBy: string;
  isLiveStream: boolean;
};

export class TrackQueue {
  private tracks: QueueTrack[] = [];

  /** Currently playing track (first in queue) */
  get current(): QueueTrack | null {
    return this.tracks[0] ?? null;
  }

  get length(): number {
    return this.tracks.length;
  }

  get items(): readonly QueueTrack[] {
    return this.tracks;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  /** Replace entire queue */
  replace(tracks: QueueTrack[]): void {
    this.tracks = [...tracks];
  }

  /** Add track(s) to end of queue */
  add(track: QueueTrack): void {
    this.tracks.push(track);
  }

  /** Remove finished current track, return new current (next track) */
  next(): QueueTrack | null {
    this.tracks.shift();
    return this.current;
  }

  remove(index: number): QueueTrack | null {
    if (index < 0 || index >= this.tracks.length) {
      return null;
    }
    const [removed] = this.tracks.splice(index, 1);
    return removed ?? null;
  }

  clear(): void {
    this.tracks = [];
  }
}
