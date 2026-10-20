// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@avoid.quest/ui/components/drawer";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { type RefObject, Suspense } from "react";
import { LazyBoundary, lazyWithRetry } from "@/components/lazy-recovery";

const SettingsForm = lazyWithRetry(() =>
  import("./settings-form").then((module) => ({ default: module.SettingsForm }))
);

/** Escape during a keyboard reorder cancels the drag, not the whole drawer. */
function keepOpenWhileReordering(event: KeyboardEvent) {
  if (
    document.querySelector("[aria-roledescription=sortable][aria-pressed=true]")
  ) {
    event.preventDefault();
  }
}

type SettingsDrawerProps = {
  defaultTab?: string;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function SettingsDrawer({
  defaultTab,
  id,
  open,
  onOpenChange,
  triggerRef,
}: SettingsDrawerProps) {
  return (
    <Drawer handleOnly={true} onOpenChange={onOpenChange} open={open}>
      <DrawerContent
        id={id}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        onEscapeKeyDown={keepOpenWhileReordering}
      >
        <div className="mx-auto w-full max-w-6xl">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription className="sr-only">
              Manage your radio stations and player settings.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            <LazyBoundary className="h-[70vh]" label="settings">
              <Suspense fallback={<Skeleton className="h-[70vh] w-full" />}>
                <SettingsForm defaultTab={defaultTab} />
              </Suspense>
            </LazyBoundary>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
