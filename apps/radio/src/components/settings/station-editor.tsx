// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { Suspense } from "react";
import { LazyBoundary, lazyWithRetry } from "@/components/lazy-recovery";
import type { Radio } from "@/lib/audio";

function preloadRadioForm() {
  return import("./radio-form");
}
const RadioForm = lazyWithRetry(() =>
  preloadRadioForm().then((module) => ({ default: module.RadioForm }))
);
const preloadRadioFromUrl = () => import("./radio-from-url-tab");
const RadioFromUrlTab = lazyWithRetry(() =>
  preloadRadioFromUrl().then((module) => ({
    default: module.RadioFromUrlTab,
  }))
);
const preloadRadioGarden = () => import("./radio-garden-tab");
const RadioGardenTab = lazyWithRetry(() =>
  preloadRadioGarden().then((module) => ({
    default: module.RadioGardenTab,
  }))
);

/** Station menus are rendered by shared components outside this file's ownership.
 * Capture intent at the player so their keyboard and pointer triggers both
 * warm the editor, without importing it while the player mounts.
 */
export function prefetchStationDialogOnIntent(event: React.SyntheticEvent) {
  if (
    event.target instanceof Element &&
    event.target.closest('[aria-haspopup="menu"]')
  ) {
    preloadRadioForm().catch(() => undefined);
    import("../radio/confirm-delete-dialog").catch(() => undefined);
  }
}

function prefetchTab(load: () => Promise<unknown>) {
  load().catch(() => undefined);
}

function LoadingStationForm() {
  return (
    <div
      className="flex min-h-48 items-center justify-center text-muted-foreground text-sm"
      role="status"
    >
      Loading station details…
    </div>
  );
}

/** Shared by the standalone editor and the station page inside Settings. */
export function StationEditor({
  mode,
  radio,
  onClose,
}: {
  mode: "create" | "edit";
  radio?: Radio;
  onClose: () => void;
}) {
  return (
    <div className="min-h-0 flex-1">
      {mode === "edit" ? (
        <LazyBoundary label="station details">
          <Suspense fallback={<LoadingStationForm />}>
            <RadioForm
              mode="edit"
              onCancel={onClose}
              onSuccess={onClose}
              radio={radio}
            />
          </Suspense>
        </LazyBoundary>
      ) : (
        <Tabs defaultValue="radiogarden">
          <TabsList className="w-full">
            <TabsTrigger
              onFocus={() => prefetchTab(preloadRadioGarden)}
              onPointerEnter={() => prefetchTab(preloadRadioGarden)}
              value="radiogarden"
            >
              Radio Garden
            </TabsTrigger>
            <TabsTrigger
              onFocus={() => prefetchTab(preloadRadioFromUrl)}
              onPointerEnter={() => prefetchTab(preloadRadioFromUrl)}
              value="from-url"
            >
              From URL
            </TabsTrigger>
            <TabsTrigger
              onFocus={() => prefetchTab(preloadRadioForm)}
              onPointerEnter={() => prefetchTab(preloadRadioForm)}
              value="manual"
            >
              Manual
            </TabsTrigger>
          </TabsList>
          <TabsContent value="radiogarden">
            <LazyBoundary label="Radio Garden search">
              <Suspense fallback={<LoadingStationForm />}>
                <RadioGardenTab onSuccess={onClose} />
              </Suspense>
            </LazyBoundary>
          </TabsContent>
          <TabsContent value="from-url">
            <LazyBoundary label="the URL importer">
              <Suspense fallback={<LoadingStationForm />}>
                <RadioFromUrlTab onSuccess={onClose} />
              </Suspense>
            </LazyBoundary>
          </TabsContent>
          <TabsContent value="manual">
            <LazyBoundary label="the station form">
              <Suspense fallback={<LoadingStationForm />}>
                <RadioForm
                  mode="create"
                  onCancel={onClose}
                  onSuccess={onClose}
                />
              </Suspense>
            </LazyBoundary>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
