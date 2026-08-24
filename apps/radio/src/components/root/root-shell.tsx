import { Toaster } from "@avoid.quest/ui/components/sonner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { useMidiControlLifecycle } from "@/lib/hooks/use-midi";
import { createRootQueryClient } from "@/lib/root/root-bootstrap";

export function RootShell({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createRootQueryClient);
  useMidiControlLifecycle();

  useEffect(() => {
    const handlePageHide = () => {
      import("@/lib/mode-lifecycle-requests").then(
        ({ modeLifecycleRequests }) =>
          modeLifecycleRequests.resetPageLifecycleState()
      );
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

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
            </div>
          </ThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
