// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Slot } from "@avoid.quest/ui/components/slot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Settings2Icon } from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { LazyBoundary, lazyWithRetry } from "@/components/lazy-recovery";

function preloadSettingsDrawer() {
  return import("./settings-drawer");
}

const SettingsDrawer = lazyWithRetry(() =>
  preloadSettingsDrawer().then((module) => ({ default: module.SettingsDrawer }))
);

function prefetchSettingsDrawerOnIntent() {
  preloadSettingsDrawer().catch(() => undefined);
}

type SettingsButtonProps = {
  defaultTab?: string;
  className?: string;
  /** Custom trigger instead of the gear icon. */
  trigger?: React.ReactElement;
};

export function SettingsButton({
  defaultTab,
  className,
  trigger,
}: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();

  // Nothing handles Escape until the drawer chunk arrives, so a pending open
  // or a load failure is dismissed here; focus inside the failure notice
  // returns to the trigger. A mounted drawer prevents the default when it
  // handles Escape itself, including while a keyboard reorder keeps it open.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const cancelPendingOpen = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        const focusInFailure =
          failureRef.current?.contains(document.activeElement) ?? false;
        setIsOpen(false);
        if (focusInFailure) {
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", cancelPendingOpen);
    return () => document.removeEventListener("keydown", cancelPendingOpen);
  }, [isOpen]);

  const triggerButton = (
    <Slot
      aria-controls={hasOpened ? drawerId : undefined}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      data-state={isOpen ? "open" : "closed"}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }
        setHasOpened(true);
        // A second activation before the drawer arrives cancels the request.
        setIsOpen((open) => !open);
      }}
      onFocus={prefetchSettingsDrawerOnIntent}
      onPointerEnter={prefetchSettingsDrawerOnIntent}
      ref={triggerRef}
      render={
        trigger ?? (
          <Button
            aria-label="Open settings"
            className={cn("size-7", className)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Settings2Icon className="size-3.5" />
          </Button>
        )
      }
    />
  );

  return (
    <>
      {trigger ? (
        triggerButton
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Settings
          </TooltipContent>
        </Tooltip>
      )}
      {/* Keep the trigger stable while loading, and the container mounted after
          first use. The open request survives a click before the chunk arrives. */}
      {hasOpened ? (
        <LazyBoundary
          className="min-h-0"
          frame={(failed) =>
            isOpen ? (
              // The drawer chunk is what failed, so the notice stays inline.
              <div
                className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-lg border bg-popover pb-3 text-popover-foreground shadow-lg"
                ref={failureRef}
              >
                {failed}
                <div className="flex justify-center">
                  <Button
                    onClick={() => {
                      setIsOpen(false);
                      // The drawer never mounted, so its close handler can't
                      // return focus to the trigger.
                      triggerRef.current?.focus();
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Close
                  </Button>
                </div>
              </div>
            ) : null
          }
          label="settings"
        >
          <Suspense fallback={null}>
            <SettingsDrawer
              defaultTab={defaultTab}
              id={drawerId}
              onOpenChange={setIsOpen}
              open={isOpen}
              triggerRef={triggerRef}
            />
          </Suspense>
        </LazyBoundary>
      ) : null}
    </>
  );
}
