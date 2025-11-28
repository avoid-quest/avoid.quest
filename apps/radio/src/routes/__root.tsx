import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import appleIcon from "@workspace/ui/assets/favicon/apple-icon.png";
import favicon from "@workspace/ui/assets/favicon/favicon.ico";
import icon0 from "@workspace/ui/assets/favicon/icon0.svg";
import icon1 from "@workspace/ui/assets/favicon/icon1.png";
import { Toaster } from "@workspace/ui/components/sonner";
import globalsCss from "@workspace/ui/globals.css?url";
import { cn } from "@workspace/ui/lib/utils";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";

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
      <HeadContent />
      <body className={cn("min-h-screen bg-background antialiased")}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <SWRegister />
          <InstallPrompt />
          <div className="relative h-screen bg-background dark:bg-linear-to-br dark:from-darkest dark:via-darker dark:to-dark">
            <Header />
            <main className="relative z-10 h-full overflow-y-auto pt-20">
              {children}
            </main>
            <Toaster />
          </div>
        </ThemeProvider>
        {import.meta.env.DEV && (
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
        )}
        <Scripts />
      </body>
    </html>
  );
}
