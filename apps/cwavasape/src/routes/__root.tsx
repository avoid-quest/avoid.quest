import appleIcon from "@avoid.quest/ui/assets/favicon/apple-icon.png";
import favicon from "@avoid.quest/ui/assets/favicon/favicon.ico";
import icon0 from "@avoid.quest/ui/assets/favicon/icon0.svg";
import icon1 from "@avoid.quest/ui/assets/favicon/icon1.png";
import { Toaster } from "@avoid.quest/ui/components/sonner";
import globalsCss from "@avoid.quest/ui/globals.css?url";
import { cn } from "@avoid.quest/ui/lib/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { initializeSettings } from "@/lib/collections";

// Lazy load devtools only in development
const Devtools = lazy(async () => {
  if (process.env.NODE_ENV !== "development") {
    return { default: () => null as React.ReactElement | null };
  }
  const [
    { TanStackDevtools },
    { TanStackRouterDevtoolsPanel },
    { ReactQueryDevtools },
  ] = await Promise.all([
    import("@tanstack/react-devtools"),
    import("@tanstack/react-router-devtools"),
    import("@tanstack/react-query-devtools"),
  ]);
  return {
    default: () => (
      <>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <ReactQueryDevtools initialIsOpen={false} />
      </>
    ),
  };
});

export const Route = createRootRoute({
  ssr: false,
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
        title: "cwavasape - avoid.quest",
      },
      {
        name: "description",
        content: "Pinterest fullscreen gallery viewer",
      },
      {
        name: "theme-color",
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

  component: RootDocument,
});

function RootDocument() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
          },
        },
      })
  );

  // Initialize TanStack DB collections with default data
  useEffect(() => {
    initializeSettings();
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
            defaultTheme="dark"
            disableTransitionOnChange
            enableSystem
          >
            <div className="relative flex h-screen flex-col bg-black">
              <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
                <Outlet />
              </main>
              <Toaster />
            </div>
          </ThemeProvider>
          {process.env.NODE_ENV === "development" && (
            <Suspense fallback={null}>
              <Devtools />
            </Suspense>
          )}
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
