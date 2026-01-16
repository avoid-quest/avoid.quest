import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appleIcon from "@workspace/ui/assets/favicon/apple-icon.png";
import favicon from "@workspace/ui/assets/favicon/favicon.ico";
import icon0 from "@workspace/ui/assets/favicon/icon0.svg";
import icon1 from "@workspace/ui/assets/favicon/icon1.png";
import { Toaster } from "@workspace/ui/components/sonner";
import globalsCss from "@workspace/ui/globals.css?url";
import { cn } from "@workspace/ui/lib/utils";
import { lazy, Suspense } from "react";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";

// Lazy load devtools only in development to avoid bundling in production
const Devtools = lazy(async () => {
  if (process.env.NODE_ENV !== "development") {
    return { default: () => null as React.ReactElement | null };
  }
  const [{ TanStackDevtools }, { TanStackRouterDevtoolsPanel }] =
    await Promise.all([
      import("@tanstack/react-devtools"),
      import("@tanstack/react-router-devtools"),
    ]);
  return {
    default: () => (
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
    ),
  };
});

export const Route = createRootRoute({
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
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* biome-ignore lint/style/noHeadElement: TanStack Router requires <head> in shellComponent */}
      <head>
        <HeadContent />
      </head>
      <body className={cn("min-h-screen bg-background antialiased")}>
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
            <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pt-20">
              {children}
            </main>
            <Toaster />
          </div>
        </ThemeProvider>
        {process.env.NODE_ENV === "development" && (
          <Suspense fallback={null}>
            <Devtools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  );
}
