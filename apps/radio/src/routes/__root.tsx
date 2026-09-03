/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import appleIcon from "@avoid.quest/ui/assets/favicon/apple-icon.png";
import favicon from "@avoid.quest/ui/assets/favicon/favicon.ico";
import icon0 from "@avoid.quest/ui/assets/favicon/icon0.svg";
import icon1 from "@avoid.quest/ui/assets/favicon/icon1.png";
import globalsCss from "@avoid.quest/ui/globals.css?url";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { RadioLoadingSkeleton } from "@/components/radio/radio-loading-skeleton";
import { NotFoundView, RootErrorView } from "@/components/root/root-error-view";
import { RootShell } from "@/components/root/root-shell";
import type { SyncChanges } from "@/lib/collections/radios";

const SyncDialog = lazy(() =>
  import("@/components/settings/sync-dialog").then((module) => ({
    default: module.SyncDialog,
  }))
);

function RootPending() {
  return <RadioLoadingSkeleton phase="database" />;
}

export const Route = createRootRoute({
  component: RootContent,
  errorComponent: RootErrorView,
  head: () => ({
    links: [
      {
        href: globalsCss,
        precedence: "default",
        rel: "stylesheet",
      },
      {
        href: "/manifest.json",
        rel: "manifest",
      },
      {
        href: favicon,
        rel: "icon",
        type: "image/x-icon",
      },
      {
        href: appleIcon,
        rel: "apple-touch-icon",
      },
      {
        href: icon0,
        rel: "icon",
        type: "image/svg+xml",
      },
      {
        href: icon1,
        rel: "icon",
        type: "image/png",
      },
    ],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "radio - avoid.quest",
      },
      {
        content: "Enhanced internet radio",
        name: "description",
      },
      {
        content: "radio.avoid.quest",
        name: "apple-mobile-web-app-title",
      },
      {
        content: "yes",
        name: "mobile-web-app-capable",
      },
      {
        content: "black",
        name: "apple-mobile-web-app-status-bar-style",
      },
      {
        content: "Radio - avoid.quest",
        name: "application-name",
      },
      {
        content: "#000000",
        name: "theme-color",
      },
      {
        content: "#000000",
        name: "msapplication-TileColor",
      },
    ],
  }),
  headers: () => ({
    "Cross-Origin-Embedder-Policy": "credentialless",
    // Required for SharedArrayBuffer support in AudioWorklet
    "Cross-Origin-Opener-Policy": "same-origin",
  }),
  loader: async () => {
    const { loadRootSyncChanges } = await import("@/lib/root/root-bootstrap");
    return loadRootSyncChanges();
  },
  notFoundComponent: NotFoundView,
  pendingComponent: RootPending,
  pendingMinMs: 0,
  pendingMs: 0,

  shellComponent: RootShell,
  ssr: false,
});

function RootContent() {
  const initialSyncChanges = Route.useLoaderData();
  const [syncChanges, setSyncChanges] = useState<SyncChanges | null>(
    initialSyncChanges
  );
  const [showSyncDialog, setShowSyncDialog] = useState(
    Boolean(initialSyncChanges)
  );

  const handleApplySyncChanges = (changes: SyncChanges) => {
    import("@/lib/root/root-bootstrap")
      .then(({ applyRootSyncChanges }) => {
        applyRootSyncChanges(changes);
        setSyncChanges(null);
      })
      .catch((error) => {
        console.error("[radio] Failed to apply radio sync changes:", error);
      });
  };

  return (
    <>
      <Outlet />
      {syncChanges ? (
        <Suspense fallback={null}>
          <SyncDialog
            changes={syncChanges}
            onApply={handleApplySyncChanges}
            onOpenChange={setShowSyncDialog}
            open={showSyncDialog}
          />
        </Suspense>
      ) : null}
    </>
  );
}
