import { TooltipProvider } from "@avoid.quest/ui/components/tooltip";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { type ComponentProps, useEffect } from "react";

function BrowserThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!resolvedTheme) {
      return;
    }
    const update = () => {
      let meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      // Resolve the token rather than the body's dark gradient.
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--background)";
      probe.hidden = true;
      document.body.appendChild(probe);
      meta.content = getComputedStyle(probe).backgroundColor;
      probe.remove();
    };
    // next-themes applies the class in its parent effect, after this child effect.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "style", "data-theme"],
      attributes: true,
    });
    update();
    return () => observer.disconnect();
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <BrowserThemeColor />
      <TooltipProvider>{children}</TooltipProvider>
    </NextThemesProvider>
  );
}
