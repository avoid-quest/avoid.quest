import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Footer } from "@/components/footer";
import { Providers } from "@/components/providers";

import "@workspace/ui/globals.css";

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
  title: "avoid.quest",
  description: "avoid.quest",
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
        <meta content="avoid.quest" name="apple-mobile-web-app-title" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <div className="grid h-svh grid-rows-[1fr_auto]">
            <main className="h-full w-full">{children}</main>
            <Footer />
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
