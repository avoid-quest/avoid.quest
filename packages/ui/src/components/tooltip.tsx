/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";
import { createContext, useContext, useId, useState } from "react";

const TooltipProviderContext = createContext(false);
const TooltipDescriptionContext = createContext<{
  id: string;
  open: boolean;
} | null>(null);

function TooltipProvider({
  delay = 300,
  closeDelay = 0,
  timeout = 300,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipProviderContext value={true}>
      <TooltipPrimitive.Provider
        closeDelay={closeDelay}
        delay={delay}
        timeout={timeout}
        {...props}
      />
    </TooltipProviderContext>
  );
}

function Tooltip({ onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const hasProvider = useContext(TooltipProviderContext);
  const id = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    props.defaultOpen ?? false
  );
  const tooltip = (
    <TooltipDescriptionContext
      value={{ id, open: !props.disabled && (props.open ?? uncontrolledOpen) }}
    >
      <TooltipPrimitive.Root
        {...props}
        onOpenChange={(open, eventDetails) => {
          onOpenChange?.(open, eventDetails);
          if (!eventDetails.isCanceled) {
            setUncontrolledOpen(open);
          }
        }}
      />
    </TooltipDescriptionContext>
  );
  return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}

function TooltipTrigger({
  onFocus,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const description = useContext(TooltipDescriptionContext);
  return (
    <TooltipPrimitive.Trigger
      aria-describedby={
        [ariaDescribedBy, description?.open ? description.id : undefined]
          .filter(Boolean)
          .join(" ") || undefined
      }
      data-slot="tooltip-trigger"
      onFocus={(event) => {
        onFocus?.(event);
        // A closing dialog returning pointer focus should not open a tooltip.
        if (!event.currentTarget.matches(":focus-visible")) {
          event.preventBaseUIHandler();
        }
      }}
      {...props}
    />
  );
}

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, "className"> &
  Pick<
    TooltipPrimitive.Positioner.Props,
    | "align"
    | "alignOffset"
    | "side"
    | "sideOffset"
    | "collisionBoundary"
    | "collisionPadding"
    | "sticky"
  > & { className?: string };

function TooltipContent({
  className,
  side = "top",
  sideOffset = 0,
  align = "center",
  alignOffset,
  collisionBoundary,
  collisionPadding,
  sticky,
  children,
  ...props
}: TooltipContentProps) {
  const description = useContext(TooltipDescriptionContext);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        sticky={sticky}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-none bg-foreground px-3 py-1.5 text-background text-xs has-data-[slot=kbd]:pr-1.5 data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-none",
            className
          )}
          data-slot="tooltip-content"
          id={description?.id}
          role="tooltip"
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-none bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-start]:top-1/2! data-[side=left]:top-1/2! data-[side=right]:top-1/2! data-[side=inline-start]:-right-1 data-[side=left]:-right-1 data-[side=top]:-bottom-2.5 data-[side=inline-end]:-left-1 data-[side=right]:-left-1 data-[side=inline-end]:translate-x-[1.5px] data-[side=inline-start]:translate-x-[-1.5px] data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:-translate-y-1/2 data-[side=right]:-translate-y-1/2" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
