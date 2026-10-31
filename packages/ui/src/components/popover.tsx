/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { isToastInteraction } from "@avoid.quest/ui/lib/toast-layer";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";

function Popover({ onOpenChange, ...props }: PopoverPrimitive.Root.Props) {
  return (
    <PopoverPrimitive.Root
      onOpenChange={(open, eventDetails) => {
        if (!open && isToastInteraction(eventDetails.event)) {
          eventDetails.cancel();
          return;
        }
        onOpenChange?.(open, eventDetails);
      }}
      {...props}
    />
  );
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

type PopoverContentProps = Omit<PopoverPrimitive.Popup.Props, "className"> &
  Pick<
    PopoverPrimitive.Positioner.Props,
    | "align"
    | "alignOffset"
    | "side"
    | "sideOffset"
    | "collisionBoundary"
    | "collisionPadding"
    | "sticky"
    | "anchor"
  > & { className?: string };

function PopoverContent({
  className,
  align = "center",
  alignOffset,
  side = "bottom",
  sideOffset = 4,
  collisionBoundary,
  collisionPadding,
  sticky,
  anchor,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        sticky={sticky}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-none bg-popover p-4 text-popover-foreground text-sm shadow-md outline-hidden ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in",
            className
          )}
          data-slot="popover-content"
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
