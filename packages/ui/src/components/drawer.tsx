/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { keepOpenOnToastInteraction } from "@avoid.quest/ui/lib/toast-layer";
import { cn } from "@avoid.quest/ui/lib/utils";
import type { ComponentProps } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

// Shorten CSS enter/exit animations while Vaul keeps its drag/snap transitions
// and JS bookkeeping. Reduced motion uses the shared near-instant duration.
const DRAWER_ANIMATION =
  "motion-safe:[animation-duration:200ms]! motion-safe:data-[state=closed]:[animation-duration:140ms]!";

/** Focus moves into the drawer on open (vaul defaults this off). */
function Drawer({
  autoFocus = true,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root autoFocus={autoFocus} data-slot="drawer" {...props} />
  );
}

function DrawerHandle({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Handle>) {
  return <DrawerPrimitive.Handle data-slot="drawer-handle" {...props} />;
}

function DrawerTrigger({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({
  ...props
}: ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn(
        DRAWER_ANIMATION,
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/20 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      data-slot="drawer-overlay"
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  onInteractOutside,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn(
          DRAWER_ANIMATION,
          "group/drawer-content fixed z-50 flex h-auto flex-col bg-popover text-popover-foreground text-sm",
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[95vh] data-[vaul-drawer-direction=top]:border-b",
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[95vh] data-[vaul-drawer-direction=bottom]:border-t",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm",
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm",
          className
        )}
        data-slot="drawer-content"
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          keepOpenOnToastInteraction(event);
        }}
        {...props}
      >
        <DrawerHandle className="mx-auto mt-4 hidden h-2 w-25! shrink-0 cursor-grab rounded-none bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1 p-4 pb-0 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-2 md:text-left",
        className
      )}
      data-slot="drawer-header"
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-auto flex shrink-0 flex-col gap-2 p-4 pt-0", className)}
      data-slot="drawer-footer"
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn(
        "font-heading font-semibold text-foreground text-lg uppercase tracking-wider",
        className
      )}
      data-slot="drawer-title"
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn(
        "mt-0.5 text-balance text-muted-foreground text-sm leading-relaxed",
        className
      )}
      data-slot="drawer-description"
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
