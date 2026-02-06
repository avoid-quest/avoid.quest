import AvoidLogo from "@avoid.quest/ui/components/avoid-logo";
import { ModeToggle } from "@avoid.quest/ui/components/mode-toggle";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { ClientOnly } from "../client-only";
import { ModeSelect } from "../settings/mode-select";
import { SettingsButton } from "../settings/settings-button";

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex h-12 items-center justify-between gap-3 border-border/50 border-b bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 supports-backdrop-filter:bg-background/60 dark:bg-background/80">
      <a className="flex shrink-0 items-center gap-1.5" href="/">
        <AvoidLogo className="size-7" />
        <span className="hidden font-mono text-foreground/80 text-xs uppercase tracking-wider sm:block">
          radio
        </span>
      </a>

      <ClientOnly fallback={<Skeleton className="h-7 w-full max-w-xs" />}>
        <ModeSelect />
      </ClientOnly>

      <div className="flex shrink-0 items-center gap-1.5 [&_button]:size-7 [&_button]:text-xs">
        <SettingsButton />
        <ModeToggle />
      </div>
    </header>
  );
}
