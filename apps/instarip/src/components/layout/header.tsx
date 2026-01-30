import { Button } from "@avoid.quest/ui/components/button";
import { Link } from "@tanstack/react-router";
import { HomeIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

export function Header() {
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <Link className="flex items-center gap-2 font-bold text-xl" to="/">
          <HomeIcon className="size-5" />
          <span>Instarip</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            size="icon"
            variant="ghost"
          >
            <SunIcon className="size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <MoonIcon className="absolute size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
