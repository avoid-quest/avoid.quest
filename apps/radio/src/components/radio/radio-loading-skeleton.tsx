import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import type { Settings } from "@/lib/types";

type RadioMode = Settings["player"]["mode"];

const CARDS = ["one", "two", "three", "four", "five", "six"];
const ROWS = ["one", "two", "three", "four", "five"];

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

function SingleRadioLoadingSkeleton() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl px-3 py-3">
      <div className="flex h-full min-h-0 w-full overflow-hidden rounded-lg border border-border/50 bg-card/50">
        <section className="flex min-h-0 w-full flex-col border-border/50 lg:w-80 lg:shrink-0 lg:border-r xl:w-96">
          <div className="space-y-2 px-3 py-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-1 px-1.5">
            {ROWS.map((row) => (
              <div
                className="flex items-center gap-3 rounded-lg px-2.5 py-2.5"
                key={row}
              >
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="hidden min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6 lg:flex">
          <Skeleton className="size-52 rounded-xl" />
          <div className="w-full max-w-sm space-y-3">
            <Skeleton className="mx-auto h-5 w-44" />
            <Skeleton className="mx-auto h-3 w-64" />
          </div>
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-2 w-full max-w-md" />
        </section>
      </div>
    </div>
  );
}

function MultipleRadioLoadingSkeleton() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden px-4 py-6">
      <Skeleton className="mb-4 h-8 w-full" />
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 p-3">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-2 flex-1" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <section
            className="space-y-4 rounded-lg border border-border/50 bg-card/40 p-4"
            key={card}
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
            <Skeleton className="h-2 w-full" />
            <div className="flex justify-between">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-8 w-20" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DjRadioLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 p-2">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_18rem_minmax(0,1fr)]">
        {["deck-a", "deck-b"].map((deck, index) => (
          <section
            className={
              index === 1
                ? "hidden space-y-3 rounded-lg border border-border/50 bg-card/40 p-3 lg:col-start-3 lg:row-start-1 lg:block"
                : "space-y-3 rounded-lg border border-border/50 bg-card/40 p-3"
            }
            key={deck}
          >
            <Skeleton className={index === 1 ? "ml-auto h-3 w-8" : "h-3 w-8"} />
            <div className="flex items-center gap-3 rounded-md border border-border/40 p-3">
              <Skeleton className="size-12 shrink-0" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="space-y-4 rounded-md border border-border/40 p-3">
              {ROWS.slice(0, 4).map((row) => (
                <div className="flex items-center gap-3" key={row}>
                  <Skeleton className="h-3 w-8" />
                  <Skeleton className="h-2 flex-1" />
                  <Skeleton className="h-3 w-9" />
                </div>
              ))}
            </div>
            <Skeleton className="h-36 w-full" />
          </section>
        ))}
        <section className="hidden space-y-5 rounded-lg border border-border/50 bg-card/40 p-4 lg:col-start-2 lg:row-start-1 lg:block">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-px w-full" />
          <div className="space-y-2 pt-28">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </section>
      </div>
      <section className="hidden shrink-0 space-y-3 rounded-lg border border-border/50 bg-card/40 p-3 sm:block">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {CARDS.map((card) => (
            <Skeleton className="h-14 w-full" key={card} />
          ))}
        </div>
      </section>
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
      {mode === "multiple" && <MultipleRadioLoadingSkeleton />}
      {mode === "dj" && <DjRadioLoadingSkeleton />}
    </LoadingFrame>
  );
}
