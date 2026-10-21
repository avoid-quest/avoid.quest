// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
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

type RadioDialogProps = {
  mode: "create" | "edit";
  radio?: Radio;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RadioDialog({
  mode,
  radio,
  open,
  onOpenChange,
}: RadioDialogProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  const isEdit = mode === "edit";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? "Edit station" : "Add station"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update station details."
              : "Search Radio Garden, fetch from a URL, or enter details manually."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isEdit ? (
            <LazyBoundary label="station details">
              <Suspense fallback={<LoadingStationForm />}>
                <RadioForm
                  mode="edit"
                  onCancel={handleClose}
                  onSuccess={handleClose}
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
                    <RadioGardenTab onSuccess={handleClose} />
                  </Suspense>
                </LazyBoundary>
              </TabsContent>
              <TabsContent value="from-url">
                <LazyBoundary label="the URL importer">
                  <Suspense fallback={<LoadingStationForm />}>
                    <RadioFromUrlTab onSuccess={handleClose} />
                  </Suspense>
                </LazyBoundary>
              </TabsContent>
              <TabsContent value="manual">
                <LazyBoundary label="the station form">
                  <Suspense fallback={<LoadingStationForm />}>
                    <RadioForm
                      mode="create"
                      onCancel={handleClose}
                      onSuccess={handleClose}
                    />
                  </Suspense>
                </LazyBoundary>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
