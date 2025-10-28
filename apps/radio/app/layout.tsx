import { Toaster } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SWRegister } from "@/components/pwa/sw-register";
import { Header } from "@/components/theme/header";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "@workspace/ui/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import appleIcon from "@workspace/ui/assets/favicon/apple-icon.png";
import favicon from "@workspace/ui/assets/favicon/favicon.ico";
import icon0 from "@workspace/ui/assets/favicon/icon0.svg";
import icon1 from "@workspace/ui/assets/favicon/icon1.png";

export const metadata: Metadata = {
  title: "radio - avoid.quest",
  description: "Enhanced internet radio",
  manifest: "https://avoid.quest/manifest.json",
  icons: [
    {
      rel: "icon",
      type: "image/x-icon",
      url: favicon.src,
    },
    {
      rel: "apple-touch-icon",
      url: appleIcon.src,
    },
    {
      rel: "icon",
      type: "image/svg+xml",
      url: icon0.src,
    },
    {
      rel: "icon",
      type: "image/png",
      url: icon1.src,
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta content="radio.avoid.quest" name="apple-mobile-web-app-title" />
      </head>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "min-h-screen bg-background antialiased"
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <SWRegister />
          <div className="relative h-screen bg-background dark:bg-linear-to-br dark:from-darkest dark:via-darker dark:to-dark">
            <Header />
            <main className="relative z-10 h-full overflow-y-auto pt-20">
              {children}
            </main>
            <Toaster />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
