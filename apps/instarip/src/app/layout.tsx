import { Toaster } from "@workspace/ui/components/sonner";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Header } from "@/components/layout/header";
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
  title: "instarip - avoid.quest",
  description:
    "A tool designed to help non-Instagram users stay updated with content that's exclusively published on Instagram.",
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
    <html lang="en">
      <head>
        <meta
          content="instarip.avoid.quest"
          name="apple-mobile-web-app-title"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} dark antialiased`}
      >
        <NuqsAdapter>
          <Header />
          <main className="container mx-auto px-4 py-8">{children}</main>
        </NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
