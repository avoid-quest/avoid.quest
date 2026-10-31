/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { isToastInteraction } from "@avoid.quest/ui/lib/toast-layer";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconX as XIcon } from "@tabler/icons-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

const {
  Root,
  Trigger,
  Portal,
  Close,
  Title,
  Description,
  Backdrop: Overlay,
  Popup: Content,
} = DialogPrimitive;

function Dialog({ onOpenChange, ...props }: DialogPrimitive.Root.Props) {
  return (
    <Root
      onOpenChange={(open, details) => {
        if (!open && isToastInteraction(details.event)) {
          details.cancel();
          return;
        }
        onOpenChange?.(open, details);
      }}
      {...props}
    />
  );
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof Trigger>) {
  return <Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof Portal>) {
  return <Portal {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof Close>) {
  return <Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof Overlay>) {
  return (
    <Overlay
      className={cn(
        "data-open:fade-in-0 data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/20 duration-100 data-closed:animate-out data-open:animate-in supports-backdrop-filter:backdrop-blur-sm",
        className
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

/**
 * Where focus should go back to when a dialog closes. A dialog opened from a
 * menu item has no trigger of its own, and the item is gone by then, so use
 * the button that opened the menu.
 */
function getMenuReturnFocusTarget(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null;
  }
  const menu = active.closest<HTMLElement>("[role=menu]");
  if (menu?.id) {
    const menuTrigger = document.querySelector<HTMLElement>(
      `[aria-controls="${CSS.escape(menu.id)}"]`
    );
    if (menuTrigger) {
      return menuTrigger;
    }
  }
  return null;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  finalFocus,
  ref,
  ...props
}: React.ComponentProps<typeof Content> & {
  showCloseButton?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [menuReturnFocusTarget, setMenuReturnFocusTarget] =
    useState<HTMLElement | null>(null);
  // Remember the menu trigger while its focused item still exists. The menu
  // may unmount before the dialog's initialFocus callback runs.
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (!popupRef.current && event.target instanceof Element) {
        returnFocusRef.current = getMenuReturnFocusTarget(event.target);
      }
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <Content
        className={cn(
          "data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 rounded-none bg-popover p-6 text-popover-foreground text-sm shadow-md outline-none ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in sm:max-w-md",
          className
        )}
        data-slot="dialog-content"
        finalFocus={
          finalFocus ??
          (menuReturnFocusTarget
            ? () =>
                menuReturnFocusTarget.isConnected ? menuReturnFocusTarget : true
            : true)
        }
        initialFocus={(interactionType) => {
          const target = getMenuReturnFocusTarget(document.activeElement);
          const rememberedTarget = target ?? returnFocusRef.current;
          setMenuReturnFocusTarget(
            rememberedTarget?.isConnected ? rememberedTarget : null
          );
          returnFocusRef.current = null;
          if (typeof initialFocus === "function") {
            return initialFocus(interactionType);
          }
          if (typeof initialFocus === "object") {
            return initialFocus.current;
          }
          return initialFocus ?? true;
        }}
        ref={(node) => {
          popupRef.current = node;
          const cleanup = typeof ref === "function" ? ref(node) : undefined;
          if (ref && typeof ref !== "function") {
            ref.current = node;
          }
          return () => {
            popupRef.current = null;
            if (typeof cleanup === "function") {
              cleanup();
            } else if (typeof ref === "function") {
              ref(null);
            } else if (ref) {
              ref.current = null;
            }
          };
        }}
        {...props}
      >
        {children}
        {showCloseButton.valueOf() && (
          <Close
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity after:absolute after:inset-0 hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-open:bg-accent data-open:text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [@media(pointer:coarse)]:after:-inset-3.5"
            data-slot="dialog-close"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Close>
        )}
      </Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof Title>) {
  return (
    <Title
      className={cn(
        "cn-font-heading font-semibold text-lg uppercase leading-none tracking-wider",
        className
      )}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof Description>) {
  return (
    <Description
      className={cn(
        "mt-0.5 text-muted-foreground text-sm leading-relaxed *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
