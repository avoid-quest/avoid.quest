"use client";

import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import {
  type AudioDebugSnapshot,
  clearAudioDebugSources,
  type Html5LoadModeOverride,
  useAudioDebug,
} from "@/lib/audio";

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value)}ms`;
}

function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}s`;
}

function readyStateLabel(value: number | null): string {
  switch (value) {
    case 0:
      return "0 HAVE_NOTHING";
    case 1:
      return "1 HAVE_METADATA";
    case 2:
      return "2 HAVE_CURRENT_DATA";
    case 3:
      return "3 HAVE_FUTURE_DATA";
    case 4:
      return "4 HAVE_ENOUGH_DATA";
    default:
      return "n/a";
  }
}

function networkStateLabel(value: number | null): string {
  switch (value) {
    case 0:
      return "0 NETWORK_EMPTY";
    case 1:
      return "1 NETWORK_IDLE";
    case 2:
      return "2 NETWORK_LOADING";
    case 3:
      return "3 NETWORK_NO_SOURCE";
    default:
      return "n/a";
  }
}

function DebugMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/40 px-2 py-1.5">
      <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-1 text-xs">{value}</div>
    </div>
  );
}

function AudioDebugSnapshotCard({
  snapshot,
}: {
  snapshot: AudioDebugSnapshot;
}) {
  const latencyValue = [
    snapshot.context?.sampleRate ? `${snapshot.context.sampleRate}Hz` : "n/a",
    formatSeconds(snapshot.context?.baseLatency ?? null),
    formatSeconds(snapshot.context?.outputLatency ?? null),
  ].join(" / ");
  const sourceLabel = snapshot.currentSrc ?? snapshot.streamUrl ?? "n/a";
  const pathLabel = [
    snapshot.processingPath,
    snapshot.workletActive ? "worklet" : null,
    snapshot.workletBypassed ? "bypassed" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm">{snapshot.stationName ?? snapshot.id}</div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {snapshot.mode} · {snapshot.host} · {snapshot.deliveryPath}
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          {pathLabel}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <DebugMetric label="Load Mode" value={snapshot.loadMode ?? "n/a"} />
        <DebugMetric
          label="Ready / Network"
          value={`${readyStateLabel(snapshot.readyState)} / ${networkStateLabel(snapshot.networkState)}`}
        />
        <DebugMetric
          label="Buffered Ahead"
          value={formatSeconds(snapshot.bufferedAheadSec)}
        />
        <DebugMetric
          label="First Playable"
          value={formatMs(snapshot.firstPlayableMs)}
        />
        <DebugMetric
          label="Waiting / Stalled"
          value={`${snapshot.eventCounts.waiting} / ${snapshot.eventCounts.stalled}`}
        />
        <DebugMetric
          label="Total Buffering"
          value={formatMs(snapshot.totalBufferingMs)}
        />
        <DebugMetric label="Max Gap" value={formatMs(snapshot.maxGapMs)} />
        <DebugMetric label="Latency" value={latencyValue} />
      </div>

      <div className="grid gap-1 text-[11px] text-muted-foreground">
        <div>Source: {sourceLabel}</div>
        <div>
          CORS: {snapshot.crossOrigin ?? "none"} · effects{" "}
          {snapshot.effectsActive ? "active" : "idle"} · filter{" "}
          {snapshot.filterActive ? "active" : "idle"} · context{" "}
          {snapshot.context?.state ?? "n/a"}
        </div>
      </div>
    </div>
  );
}

export function AudioDebug() {
  const { enabled, loadModeOverride, setLoadModeOverride, snapshots } =
    useAudioDebug();

  if (!enabled) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] text-amber-700 uppercase tracking-wider dark:text-amber-300">
            Audio Debug
          </div>
          <p className="text-muted-foreground text-xs">
            Hidden diagnostics for stream path, buffering, and worklet usage.
          </p>
        </div>
        <Button
          onClick={() => clearAudioDebugSources()}
          size="sm"
          variant="outline"
        >
          Clear
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
        <div className="space-y-1.5">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Load Mode Override
          </div>
          <Select
            onValueChange={(value) =>
              setLoadModeOverride(value as Html5LoadModeOverride)
            }
            value={loadModeOverride}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select override" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="no-cors">Force no-cors</SelectItem>
              <SelectItem value="proxied">Force proxied</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded border border-border/50 bg-background/40 p-2 text-[11px] text-muted-foreground">
          Use this on mobile with `?audioDebug=1`. Compare `Auto` against forced
          `no-cors` or `proxied` for stations that crackle.
        </div>
      </div>

      <div className="space-y-3">
        {snapshots.length === 0 ? (
          <div className="rounded border border-border/60 border-dashed p-3 text-muted-foreground text-xs">
            No active audio sources yet.
          </div>
        ) : (
          snapshots.map((snapshot) => (
            <AudioDebugSnapshotCard key={snapshot.id} snapshot={snapshot} />
          ))
        )}
      </div>
    </div>
  );
}
