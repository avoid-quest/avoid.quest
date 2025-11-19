import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Toaster } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SWRegister } from "@/components/pwa/sw-register";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "@workspace/ui/globals.css";

import appCss from '../styles.css?url'

import appleIcon from "@workspace/ui/assets/favicon/apple-icon.png";
import favicon from "@workspace/ui/assets/favicon/favicon.ico";
import icon0 from "@workspace/ui/assets/favicon/icon0.svg";
import icon1 from "@workspace/ui/assets/favicon/icon1.png";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'radio - avoid.quest',
      },
      {
        name: 'description',
        content: 'Enhanced internet radio',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: 'radio.avoid.quest',
      },
      {
        name: 'mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black',
      },
      {
        name: 'application-name',
        content: 'Radio - avoid.quest',
      },
      {
        name: 'theme-color',
        content: '#000000',
      },
      {
        name: 'msapplication-TileColor',
        content: '#000000',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'icon',
        type: 'image/x-icon',
        href: favicon.src,
      },
      {
        rel: 'apple-touch-icon',
        href: appleIcon.src,
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: icon0.src,
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: icon1.src,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body
        className={cn(
          "min-h-screen bg-background antialiased",
          "[--font-geist-sans:var(--font-geist-sans)]",
          "[--font-geist-mono:var(--font-geist-mono)]"
        )}
        style={{
          fontFamily: 'var(--font-geist-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
        } as React.CSSProperties}
      >
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
          <>
            <TanStackDevtools
              config={{
                position: 'bottom-right',
              }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          </>
        )}
        <Scripts />
      </body>
    </html>
  )
}
