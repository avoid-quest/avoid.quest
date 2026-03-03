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
  private position = 0;

  get current(): QueueTrack | null {
    return this.tracks[this.position] ?? null;
  }

  get length(): number {
    return this.tracks.length;
  }

  get items(): readonly QueueTrack[] {
    return this.tracks;
  }

  get currentPosition(): number {
    return this.position;
  }

  get isEmpty(): boolean {
    return this.tracks.length === 0;
  }

  add(track: QueueTrack): number {
    this.tracks.push(track);
    return this.tracks.length - 1;
  }

  next(): QueueTrack | null {
    if (this.position + 1 < this.tracks.length) {
      this.position++;
      return this.current;
    }
    return null;
  }

  remove(index: number): QueueTrack | null {
    if (index < 0 || index >= this.tracks.length) {
      return null;
    }
    const [removed] = this.tracks.splice(index, 1);
    if (index < this.position) {
      this.position--;
    } else if (index === this.position && this.position >= this.tracks.length) {
      this.position = Math.max(0, this.tracks.length - 1);
    }
    return removed ?? null;
  }

  clear(): void {
    this.tracks = [];
    this.position = 0;
  }
}
