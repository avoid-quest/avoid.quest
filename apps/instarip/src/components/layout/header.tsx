import { ModeToggle } from "@avoid.quest/ui/components/mode-toggle";
import { SiteLogo } from "@avoid.quest/ui/components/site-logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <SiteLogo href="/" name="instarip" />
        <nav className="flex items-center gap-2">
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
