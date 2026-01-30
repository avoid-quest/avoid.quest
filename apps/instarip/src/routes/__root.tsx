import appleIcon from "@avoid.quest/ui/assets/favicon/apple-icon.png";
import favicon from "@avoid.quest/ui/assets/favicon/favicon.ico";
import icon0 from "@avoid.quest/ui/assets/favicon/icon0.svg";
import icon1 from "@avoid.quest/ui/assets/favicon/icon1.png";
import { Button } from "@avoid.quest/ui/components/button";
import { Toaster } from "@avoid.quest/ui/components/sonner";
import globalsCss from "@avoid.quest/ui/globals.css?url";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { HomeIcon } from "lucide-react";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "instarip - avoid.quest" },
      { name: "description", content: "Instagram post viewer" },
      { name: "theme-color", content: "#000000" },
    ],
    links: [
      { rel: "stylesheet", href: globalsCss, precedence: "default" },
      { rel: "icon", type: "image/x-icon", href: favicon },
      { rel: "apple-touch-icon", href: appleIcon },
      { rel: "icon", type: "image/svg+xml", href: icon0 },
      { rel: "icon", type: "image/png", href: icon1 },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-2 font-bold text-6xl">404</h1>
        <h2 className="mb-4 font-semibold text-2xl">Page Not Found</h2>
        <p className="mb-6 text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <Link to="/">
          <Button size="lg">
            <HomeIcon className="mr-2 size-4" />
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}

function RootComponent() {
  // Create Convex client - URL from environment variable
  const [convex] = useState(
    () => new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)
  );

  return (
    <html lang="en" suppressHydrationWarning>
      {/* biome-ignore lint/style/noHeadElement: TanStack Router requires <head> in shellComponent */}
      <head>
        <HeadContent />
      </head>
      <body className={cn("min-h-screen bg-background antialiased")}>
        <ConvexProvider client={convex}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            disableTransitionOnChange
            enableSystem
          >
            <div className="relative flex min-h-screen flex-col bg-background">
              <main className="flex-1">
                <Outlet />
              </main>
              <Toaster />
            </div>
          </ThemeProvider>
        </ConvexProvider>
        <Scripts />
      </body>
    </html>
  );
}
