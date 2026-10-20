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
import { Suspense, useId, useRef, useState } from "react";
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
  trigger?: React.ReactNode;
};

export function SettingsButton({
  defaultTab,
  className,
  trigger,
}: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();

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
        setIsOpen(true);
      }}
      onFocus={prefetchSettingsDrawerOnIntent}
      onPointerEnter={prefetchSettingsDrawerOnIntent}
      ref={triggerRef}
    >
      {trigger ? (
        trigger
      ) : (
        <Button
          aria-label="Open settings"
          className={cn("size-7", className)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Settings2Icon className="size-3.5" />
        </Button>
      )}
    </Slot>
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
              <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-lg border bg-popover pb-3 text-popover-foreground shadow-lg">
                {failed}
                <div className="flex justify-center">
                  <Button
                    onClick={() => setIsOpen(false)}
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
