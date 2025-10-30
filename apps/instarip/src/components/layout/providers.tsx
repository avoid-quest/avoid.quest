"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
