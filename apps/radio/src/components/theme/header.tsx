import { ModeToggle } from "@workspace/ui/components/mode-toggle";
import { SiteLogo } from "@workspace/ui/components/site-logo";
import { ModeSelect } from "../settings/mode-select";
import { SettingsButton } from "../settings/settings-button";

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between gap-4 light:border-border light:border-b bg-background/80 light:bg-background/95 p-4 backdrop-blur-xl backdrop-saturate-150 supports-backdrop-filter:bg-background/60 dark:bg-background/80">
      <SiteLogo href="/" name="radio" />
      <ModeSelect />
      <div className="flex items-center gap-2">
        <SettingsButton />
        <ModeToggle />
      </div>
    </header>
  );
}
