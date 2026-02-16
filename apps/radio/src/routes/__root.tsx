import { AppError, captureError } from "@avoid.quest/error";
import appleIcon from "@avoid.quest/ui/assets/favicon/apple-icon.png";
import favicon from "@avoid.quest/ui/assets/favicon/favicon.ico";
import icon0 from "@avoid.quest/ui/assets/favicon/icon0.svg";
import icon1 from "@avoid.quest/ui/assets/favicon/icon1.png";
import { Button } from "@avoid.quest/ui/components/button";
import { Toaster } from "@avoid.quest/ui/components/sonner";
import globalsCss from "@avoid.quest/ui/globals.css?url";
import { cn } from "@avoid.quest/ui/lib/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  createRootRoute,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { SyncDialog } from "@/components/settings/sync-dialog";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";
import {
  applySyncChanges,
  initializeCollections,
  type SyncChanges,
} from "@/lib/collections";

export const Route = createRootRoute({
  ssr: false,
  errorComponent: RootErrorComponent,
  headers: () => ({
    // Required for SharedArrayBuffer support in AudioWorklet
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
  }),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "radio - avoid.quest",
      },
      {
        name: "description",
        content: "Enhanced internet radio",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "radio.avoid.quest",
      },
      {
        name: "mobile-web-app-capable",
        content: "yes",
      },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black",
      },
      {
        name: "application-name",
        content: "Radio - avoid.quest",
      },
      {
        name: "theme-color",
        content: "#000000",
      },
      {
        name: "msapplication-TileColor",
        content: "#000000",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: globalsCss,
        precedence: "default",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "icon",
        type: "image/x-icon",
        href: favicon,
      },
      {
        rel: "apple-touch-icon",
        href: appleIcon,
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: icon0,
      },
      {
        rel: "icon",
        type: "image/png",
        href: icon1,
      },
    ],
  }),

  shellComponent: RootDocument,
  notFoundComponent: NotFoundComponent,
});

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const safeMessage =
    error instanceof AppError
      ? error.safeMessage
      : "Something went wrong. Please try again.";

  useEffect(() => {
    captureError(error, {
      surface: "ui",
      operation: "root-error-boundary",
      tags: { route: "__root" },
    });
  }, [error]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-2 font-bold text-4xl">Something went wrong</h1>
        <p className="mb-6 text-muted-foreground">{safeMessage}</p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset} size="lg">
            Try Again
          </Button>
          <Link to="/">
            <Button size="lg" variant="outline">
              <HomeIcon className="mr-2 size-4" />
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-2 font-bold text-6xl">404</h1>
        <h2 className="mb-4 font-semibold text-2xl">Page Not Found</h2>
        <p className="mb-6 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
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

function RootDocument({ children }: { children: React.ReactNode }) {
  // Create QueryClient in state to ensure unique cache per request/user
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Avoid refetching immediately on mount after SSR
            staleTime: 60 * 1000,
            // Cache metadata for 5 minutes
            gcTime: 5 * 60 * 1000,
          },
        },
      })
  );

  // State for sync dialog
  const [syncChanges, setSyncChanges] = useState<SyncChanges | null>(null);
  const [showSyncDialog, setShowSyncDialog] = useState(false);

  // Initialize TanStack DB collections with default data
  useEffect(() => {
    initializeCollections().then((changes) => {
      if (changes) {
        setSyncChanges(changes);
        setShowSyncDialog(true);
      }
    });
  }, []);

  const handleApplySyncChanges = (changes: SyncChanges) => {
    applySyncChanges(changes);
    setSyncChanges(null);
  };

  return (
    <html lang="en" suppressHydrationWarning>
      {/* biome-ignore lint/style/noHeadElement: TanStack Router requires <head> in shellComponent */}
      <head>
        <HeadContent />
      </head>
      <body className={cn("min-h-screen bg-background antialiased")}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            disableTransitionOnChange
            enableSystem
          >
            <SWRegister />
            <InstallPrompt />
            <div className="relative flex h-screen flex-col bg-background dark:bg-linear-to-br dark:from-darkest dark:via-darker dark:to-dark">
              <Header />
              <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pt-12">
                {children}
              </main>
              <Toaster />
              {syncChanges && (
                <SyncDialog
                  changes={syncChanges}
                  onApply={handleApplySyncChanges}
                  onOpenChange={setShowSyncDialog}
                  open={showSyncDialog}
                />
              )}
            </div>
          </ThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
