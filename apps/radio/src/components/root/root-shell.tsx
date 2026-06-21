import { Toaster } from "@avoid.quest/ui/components/sonner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { SyncDialog } from "@/components/settings/sync-dialog";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";
import type { SyncChanges } from "@/lib/collections";
import { modeLifecycleRequests } from "@/lib/mode-lifecycle-requests";
import {
  applyRootSyncChanges,
  createRootQueryClient,
  loadRootSyncChanges,
  reportRootBootstrapError,
} from "@/lib/root/root-bootstrap";

export function RootShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createRootQueryClient);
  const [syncChanges, setSyncChanges] = useState<SyncChanges | null>(null);
  const [showSyncDialog, setShowSyncDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadRootSyncChanges()
      .then((changes) => {
        if (!(changes && !cancelled)) {
          return;
        }
        setSyncChanges(changes);
        setShowSyncDialog(true);
      })
      .catch((error) => {
        if (!cancelled) {
          reportRootBootstrapError(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      modeLifecycleRequests.resetPageLifecycleState();
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  const handleApplySyncChanges = (changes: SyncChanges) => {
    applyRootSyncChanges(changes);
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
