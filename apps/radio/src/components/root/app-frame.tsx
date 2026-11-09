import { Toaster } from "@avoid.quest/ui/components/sonner";
import { Header } from "@/components/theme/header";

/**
 * What every page draws inside the document: the header, the viewport the
 * page fills below it, and the toast layer. `RootShell` owns the document,
 * providers and client lifecycle around it.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh flex-col bg-background">
      <Header />
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pt-12">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
