"use client";

import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { useState } from "react";
import { toast } from "sonner";
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

function formatReportValue(value: number | string | null | boolean): string {
  if (value === null) {
    return "n/a";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }

  return String(value);
}

function buildAudioDebugReport(
  snapshots: AudioDebugSnapshot[],
  loadModeOverride: Html5LoadModeOverride
): string {
  const standalone =
    typeof window !== "undefined" &&
    "matchMedia" in window &&
    window.matchMedia("(display-mode: standalone)").matches;

  const lines = [
    "Radio Audio Debug Report",
    `generatedAt=${new Date().toISOString()}`,
    `href=${window.location.href}`,
    `origin=${window.location.origin}`,
    `secureContext=${String(window.isSecureContext)}`,
    `displayModeStandalone=${String(standalone)}`,
    `userAgent=${navigator.userAgent}`,
    `loadModeOverride=${loadModeOverride}`,
    `snapshotCount=${snapshots.length}`,
    "",
  ];

  if (snapshots.length === 0) {
    lines.push("No active audio sources.");
    return lines.join("\n");
  }

  snapshots.forEach((snapshot, index) => {
    lines.push(`[snapshot ${index + 1}]`);
    lines.push(
      `station=${snapshot.stationName ?? "n/a"} mode=${snapshot.mode} radioId=${snapshot.radioId ?? "n/a"} id=${snapshot.id}`
    );
    lines.push(
      `host=${snapshot.host} deliveryPath=${snapshot.deliveryPath} processingPath=${snapshot.processingPath}`
    );
    lines.push(
      `loadMode=${snapshot.loadMode ?? "n/a"} crossOrigin=${snapshot.crossOrigin ?? "none"}`
    );
    lines.push(
      `streamUrl=${snapshot.streamUrl ?? "n/a"} currentSrc=${snapshot.currentSrc ?? "n/a"}`
    );
    lines.push(
      `readyState=${readyStateLabel(snapshot.readyState)} networkState=${networkStateLabel(snapshot.networkState)} bufferedAheadSec=${formatReportValue(snapshot.bufferedAheadSec)}`
    );
    lines.push(
      `firstPlayableMs=${formatReportValue(snapshot.firstPlayableMs)} totalBufferingMs=${formatReportValue(snapshot.totalBufferingMs)} maxGapMs=${formatReportValue(snapshot.maxGapMs)} waitingSinceMs=${formatReportValue(snapshot.waitingSinceMs)}`
    );
    lines.push(`eventCounts=${JSON.stringify(snapshot.eventCounts)}`);
    lines.push(
      `contextState=${snapshot.context?.state ?? "n/a"} sampleRate=${formatReportValue(snapshot.context?.sampleRate ?? null)} baseLatency=${formatReportValue(snapshot.context?.baseLatency ?? null)} outputLatency=${formatReportValue(snapshot.context?.outputLatency ?? null)}`
    );
    lines.push(
      `usesWorklet=${String(snapshot.usesWorklet)} workletActive=${String(snapshot.workletActive)} workletBypassed=${String(snapshot.workletBypassed)} effectsActive=${String(snapshot.effectsActive)} filterActive=${String(snapshot.filterActive)}`
    );
    lines.push(
      `createdAt=${new Date(snapshot.createdAt).toISOString()} lastUpdatedAt=${new Date(snapshot.lastUpdatedAt).toISOString()} lastActivityAt=${snapshot.lastActivityAt ? new Date(snapshot.lastActivityAt).toISOString() : "n/a"}`
    );

    if (snapshot.recentEvents.length > 0) {
      lines.push("recentEvents:");
      for (const event of snapshot.recentEvents) {
        lines.push(
          `  ${new Date(event.at).toISOString()} ${event.name} ready=${readyStateLabel(event.readyState)} network=${networkStateLabel(event.networkState)} bufferedAheadSec=${formatReportValue(event.bufferedAheadSec)} currentTime=${formatReportValue(event.currentTime)}`
        );
      }
    } else {
      lines.push("recentEvents: none");
    }

    lines.push("");
  });

  return lines.join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to selection-based copy below.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard copy requires a browser document.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard copy failed.");
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
  const [isCopying, setIsCopying] = useState(false);
  const { enabled, loadModeOverride, setLoadModeOverride, snapshots } =
    useAudioDebug();

  if (!enabled) {
    return null;
  }

  const handleCopyLogs = async () => {
    setIsCopying(true);
    try {
      await copyTextToClipboard(
        buildAudioDebugReport(snapshots, loadModeOverride)
      );
      toast.success("Audio debug logs copied");
    } catch {
      toast.error("Failed to copy audio debug logs");
    } finally {
      setIsCopying(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <Button
            disabled={isCopying}
            onClick={handleCopyLogs}
            size="sm"
            variant="outline"
          >
            {isCopying ? "Copying..." : "Copy Logs"}
          </Button>
          <Button
            onClick={() => clearAudioDebugSources()}
            size="sm"
            variant="outline"
          >
            Clear
          </Button>
        </div>
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
