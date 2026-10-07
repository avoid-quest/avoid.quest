import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { describeFallback } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import {
  type BackendBadge as BackendBadgeValue,
  type NodeBackendBadgeStore,
  nodeBackendBadges,
} from "@/lib/node-playback";

/** A lowercase sans tag, `compat` or `bypassed`, titled with why. */
export function BackendBadgeLabel({
  badge,
  className,
}: {
  badge: BackendBadgeValue;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-1 py-0.5 font-medium text-[10px] leading-none",
        badge.kind === "bypassed"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
        className
      )}
      title={
        badge.kind === "bypassed"
          ? "Effects bypassed: the effects engine couldn't start, so this lane plays dry"
          : `Runs on the compatibility effects engine${badge.cause ? ` because ${describeFallback(badge.cause)}` : ""}`
      }
    >
      {badge.kind}
    </span>
  );
}

/**
 * A node's or a lane's backend badge, as node playback publishes it: the
 * compile estimate until the effects controller reports, then its outcome.
 * Nothing while the lane runs as planned.
 */
export function BackendBadge({
  nodeId,
  className,
  store = nodeBackendBadges,
}: {
  nodeId: string;
  className?: string;
  store?: NodeBackendBadgeStore;
}) {
  const badge = useStore(store, (state) => state[nodeId] ?? null);
  return badge ? (
    <BackendBadgeLabel badge={badge} className={className} />
  ) : null;
}
