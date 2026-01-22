import { SiteLogo } from "@avoid.quest/ui/components/site-logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-start px-4">
        <SiteLogo href="/" name="instarip" />
      </div>
    </header>
  );
}
