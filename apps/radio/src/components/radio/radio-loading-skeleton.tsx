import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import type { SettingsRecord } from "@/lib/collections/settings";

type RadioMode = SettingsRecord["player"]["mode"];

const ROWS = ["one", "two", "three", "four", "five"];
const STATION_NODES = ["one", "two", "three"];

function LoadingFrame({
  children,
  mode,
  phase,
}: {
  children: React.ReactNode;
  mode: RadioMode;
  phase: "database" | "mode";
}) {
  return (
    <div
      aria-busy="true"
      aria-label={`Loading ${mode} radio mode`}
      className="h-full min-h-0 w-full"
      data-loading-phase={phase}
      data-radio-mode={mode}
      data-testid="radio-loading-skeleton"
      role="status"
    >
      <span className="sr-only">Loading {mode} radio mode</span>
      {children}
    </div>
  );
}

/** A station row as drawn by station-row.tsx: logo, name, subtitle. */
function StationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2.5 py-2">
      <Skeleton className="size-10 shrink-0 rounded-sm" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2 w-1/2" />
      </div>
    </div>
  );
}

function SingleRadioLoadingSkeleton() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl px-3 py-3">
      <div className="flex h-full min-h-0 w-full overflow-hidden rounded-lg border border-border/50 bg-card/50">
        <section className="flex min-h-0 w-full flex-col border-border/50 lg:w-80 lg:shrink-0 lg:border-r xl:w-96">
          <div className="px-3 py-2">
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex flex-col gap-1 px-1.5">
            {ROWS.map((row) => (
              <StationRowSkeleton key={row} />
            ))}
          </div>
        </section>
        <section className="hidden min-h-0 flex-1 items-center justify-center p-6 lg:flex">
          <div className="flex w-full max-w-lg flex-col items-center gap-5">
            <Skeleton className="size-[clamp(15rem,36vh,22rem)] rounded-2xl" />
            <div className="flex w-full flex-col items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-56" />
            </div>
            <div className="flex w-full items-center gap-4 border-border/50 border-t pt-4">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <Skeleton className="size-7 shrink-0" />
              <Skeleton className="h-1.5 flex-1" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The patch canvas: three Station nodes cabled to Speakers. */
export function NodeCanvasSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center gap-16 overflow-hidden p-6">
      <div className="flex flex-col gap-4">
        {STATION_NODES.map((node) => (
          <section
            className="w-60 rounded-md border border-border/50 bg-card"
            key={node}
          >
            <div className="flex items-center gap-3 p-2.5">
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-2 w-1/3" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
            <div className="flex items-center gap-2 border-border/50 border-t px-3 py-1.5">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="size-7 shrink-0" />
              <Skeleton className="h-1.5 flex-1" />
            </div>
          </section>
        ))}
      </div>
      <section className="hidden w-50 rounded-md border border-border/50 bg-card sm:block">
        <div className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-6 rounded-sm" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex flex-col gap-2 border-border/50 border-t p-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      </section>
    </div>
  );
}

function NodeRadioLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="px-3 pt-3 pb-2">
        <Skeleton className="h-8 w-full max-w-md" />
      </div>
      <div className="min-h-0 flex-1">
        <NodeCanvasSkeleton />
      </div>
    </div>
  );
}

/** An empty deck: source tabs, search, station rows. */
function DeckSkeleton({ className }: { className?: string }) {
  return (
    <section className={className}>
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-8 w-full" />
        <div className="flex flex-col gap-1">
          {ROWS.map((row) => (
            <StationRowSkeleton key={row} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DjRadioLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 p-2">
      <div className="h-24 shrink-0 rounded-lg border border-border/50 bg-card/50 p-2 lg:hidden">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-border/50 bg-card/50 lg:grid-cols-[1fr_21rem_1fr]">
        <DeckSkeleton />
        <section className="hidden flex-col gap-3 border-border/50 border-x p-3 lg:flex">
          <Skeleton className="h-6 w-full" />
          <div className="grid flex-1 grid-cols-3 gap-3 border-border/50 border-t pt-3">
            {["a", "master", "b"].map((column) => (
              <div className="flex flex-col items-center gap-2" key={column}>
                <Skeleton className="size-9 rounded-full" />
                <Skeleton className="size-9 rounded-full" />
                <Skeleton className="w-2 flex-1" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </section>
        <DeckSkeleton className="hidden lg:block" />
      </div>
    </div>
  );
}

export function RadioLoadingSkeleton({
  mode = "single",
  phase = "database",
}: {
  mode?: RadioMode;
  phase?: "database" | "mode";
}) {
  return (
    <LoadingFrame mode={mode} phase={phase}>
      {mode === "single" && <SingleRadioLoadingSkeleton />}
      {mode === "node" && <NodeRadioLoadingSkeleton />}
      {mode === "dj" && <DjRadioLoadingSkeleton />}
    </LoadingFrame>
  );
}
