/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { isToastInteraction } from "@avoid.quest/ui/lib/toast-layer";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

function Dialog({ onOpenChange, ...props }: DialogPrimitive.Root.Props) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      onOpenChange={(open, details) => {
        // A toast press must not dismiss the modal underneath it.
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

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
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
}: DialogPrimitive.Popup.Props & {
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
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        className={cn(
          "data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-none bg-popover p-6 text-popover-foreground text-sm shadow-md outline-none ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in sm:max-w-md",
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
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                className="absolute top-5 right-5 bg-secondary"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <IconX />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
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

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="dialog-footer"
      {...props}
    >
      {children}
      {showCloseButton.valueOf() && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "font-heading font-semibold text-lg uppercase leading-none tracking-wider",
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
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
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
