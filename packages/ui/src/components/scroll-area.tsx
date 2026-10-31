"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type * as React from "react";

function ScrollArea({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof ScrollAreaPrimitive.Root>, "className"> & {
  className?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative overflow-hidden", className)}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className="size-full max-h-[inherit] rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-slot="scroll-area-viewport"
      >
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content">
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner className="absolute right-0 bottom-0" />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: Omit<
  React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>,
  "className"
> & { className?: string }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "absolute flex touch-none select-none p-px transition-colors data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        orientation === "vertical" &&
          "inset-y-0 right-0 w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "inset-x-0 bottom-0 h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-none bg-border"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
