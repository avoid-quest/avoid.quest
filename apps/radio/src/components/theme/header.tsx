import AvoidLogo from "@avoid.quest/ui/components/avoid-logo";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { lazy, Suspense } from "react";
import { ClientOnly } from "../client-only";

const AppFeedback = lazy(() =>
  import("../feedback/app-feedback").then((module) => ({
    default: module.AppFeedback,
  }))
);
const ModeSelect = lazy(() =>
  import("../settings/mode-select").then((module) => ({
    default: module.ModeSelect,
  }))
);
const SettingsButton = lazy(() =>
  import("../settings/settings-button").then((module) => ({
    default: module.SettingsButton,
  }))
);
const WhatsNew = lazy(() =>
  import("../changelog/whats-new").then((module) => ({
    default: module.WhatsNew,
  }))
);

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex h-12 items-center justify-between gap-3 border-border/50 border-b bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 supports-backdrop-filter:bg-background/60 dark:bg-background/80">
      <a
        className="flex shrink-0 items-center gap-1.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        href="/"
      >
        <AvoidLogo className="size-7" />
        <span className="hidden font-mono text-foreground/80 text-xs uppercase tracking-wider sm:block">
          radio
        </span>
      </a>

      <ClientOnly fallback={<Skeleton className="h-7 w-full max-w-xs" />}>
        <Suspense fallback={<Skeleton className="h-7 w-full max-w-xs" />}>
          <ModeSelect className="max-sm:max-w-none" />
        </Suspense>
      </ClientOnly>

      {/* One look for every icon button: muted, lit on hover and while open. */}
      <div className="flex shrink-0 items-center gap-1.5 [&_button]:size-7 [&_button]:text-muted-foreground [&_button]:text-xs [&_button]:aria-expanded:bg-accent [&_button]:aria-expanded:text-accent-foreground dark:[&_button]:aria-expanded:bg-accent/50 [&_button_svg]:size-3.5">
        <div className="hidden sm:contents">
          <ClientOnly>
            <Suspense fallback={null}>
              <AppFeedback />
            </Suspense>
          </ClientOnly>
          <ClientOnly fallback={<Skeleton className="size-7" />}>
            <Suspense fallback={<Skeleton className="size-7" />}>
              <WhatsNew />
            </Suspense>
          </ClientOnly>
        </div>
        <ClientOnly fallback={<Skeleton className="size-7" />}>
          <Suspense fallback={<Skeleton className="size-7" />}>
            <SettingsButton />
          </Suspense>
        </ClientOnly>
      </div>
    </header>
  );
}
