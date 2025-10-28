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

export const metadata: Metadata = {
  title: "instarip",
  description:
    "A tool designed to help non-Instagram users stay updated with content that's exclusively published on Instagram.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta content="avoid.quest" name="apple-mobile-web-app-title" />
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
