"use client";

import dynamic from "next/dynamic";

// Dynamic import with SSR disabled for browser-only APIs
const ImportPage = dynamic(
  () => import("@/components/import-page").then((mod) => mod.ImportPage),
  {
    ssr: false,
  }
);

export default function Import() {
  return <ImportPage />;
}
