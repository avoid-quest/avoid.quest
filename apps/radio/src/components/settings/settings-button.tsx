import { Button } from "@avoid.quest/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@avoid.quest/ui/components/drawer";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Settings2Icon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

const SettingsForm = lazy(() =>
  import("./settings-form").then((module) => ({ default: module.SettingsForm }))
);

type SettingsButtonProps = {
  defaultTab?: string;
  className?: string;
  /** Custom trigger instead of the gear icon. */
  trigger?: React.ReactNode;
};

/** Escape during a keyboard reorder cancels the drag, not the whole drawer. */
function keepOpenWhileReordering(event: KeyboardEvent) {
  if (
    document.querySelector("[aria-roledescription=sortable][aria-pressed=true]")
  ) {
    event.preventDefault();
  }
}

export function SettingsButton({
  defaultTab,
  className,
  trigger,
}: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer handleOnly={true} onOpenChange={setIsOpen} open={isOpen}>
      {trigger ? (
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      ) : (
        <Tooltip>
          {/* Drawer outside the tooltip, so its data-state is the one kept. */}
          <DrawerTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                aria-label="Open settings"
                className={cn("size-7", className)}
                size="icon"
                variant="ghost"
              >
                <Settings2Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
          </DrawerTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Settings
          </TooltipContent>
        </Tooltip>
      )}
      <DrawerContent onEscapeKeyDown={keepOpenWhileReordering}>
        <div className="mx-auto w-full max-w-6xl">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription className="sr-only">
              Manage your radio stations and player settings.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            <Suspense fallback={<Skeleton className="h-[70vh] w-full" />}>
              <SettingsForm defaultTab={defaultTab} />
            </Suspense>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
