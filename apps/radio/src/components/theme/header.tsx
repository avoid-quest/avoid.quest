import AvoidLogo from "@avoid.quest/ui/components/avoid-logo";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { Suspense, useSyncExternalStore } from "react";
import { ClientOnly } from "../client-only";
import { LazyBoundary, lazyWithRetry } from "../lazy-recovery";

// Each control loads and fails on its own, so a missing chunk costs one button.
const AppFeedback = lazyWithRetry(() =>
  import("../feedback/app-feedback").then((module) => ({
    default: module.AppFeedback,
  }))
);
const ModeSelect = lazyWithRetry(() =>
  import("../settings/mode-select").then((module) => ({
    default: module.ModeSelect,
  }))
);
const SettingsButton = lazyWithRetry(() =>
  import("../settings/settings-button").then((module) => ({
    default: module.SettingsButton,
  }))
);
const WhatsNew = lazyWithRetry(() =>
  import("../changelog/whats-new").then((module) => ({
    default: module.WhatsNew,
  }))
);

const desktopQuery = "(min-width: 640px)";
function subscribeDesktop(listener: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const getServerDesktopSnapshot = () => false;

function DesktopWidgetsPlaceholder() {
  return (
    <>
      <Skeleton className="size-7" />
      <Skeleton className="size-7" />
    </>
  );
}

function DesktopWidgets() {
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getServerDesktopSnapshot
  );
  if (!desktop) {
    return <DesktopWidgetsPlaceholder />;
  }
  return (
    <>
      <LazyBoundary label="feedback" variant="icon">
        <Suspense fallback={<Skeleton className="size-7" />}>
          <AppFeedback />
        </Suspense>
      </LazyBoundary>
      <LazyBoundary label="what's new" variant="icon">
        <Suspense fallback={<Skeleton className="size-7" />}>
          <WhatsNew />
        </Suspense>
      </LazyBoundary>
    </>
  );
}

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
        <LazyBoundary
          className="w-full max-w-xs max-sm:max-w-none"
          label="modes"
          variant="inline"
        >
          <Suspense fallback={<Skeleton className="h-7 w-full max-w-xs" />}>
            <ModeSelect className="max-sm:max-w-none" />
          </Suspense>
        </LazyBoundary>
      </ClientOnly>

      {/* One look for every icon button: muted, lit on hover and while open. */}
      <div className="flex shrink-0 items-center gap-1.5 [&_button]:size-7 [&_button]:text-muted-foreground [&_button]:text-xs [&_button]:aria-expanded:bg-accent [&_button]:aria-expanded:text-accent-foreground dark:[&_button]:aria-expanded:bg-accent/50 [&_button_svg]:size-3.5">
        <div className="hidden sm:contents">
          <ClientOnly fallback={<DesktopWidgetsPlaceholder />}>
            <DesktopWidgets />
          </ClientOnly>
        </div>
        <ClientOnly fallback={<Skeleton className="size-7" />}>
          <LazyBoundary label="settings" variant="icon">
            <Suspense fallback={<Skeleton className="size-7" />}>
              <SettingsButton />
            </Suspense>
          </LazyBoundary>
        </ClientOnly>
      </div>
    </header>
  );
}
