/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import {
  IconCheck as CheckIcon,
  IconChevronRight as ChevronRightIcon,
  IconCircle as CircleIcon,
} from "@tabler/icons-react";
import type * as React from "react";

type ContextMenuContentProps = React.ComponentProps<
  typeof ContextMenuPrimitive.Popup
> &
  Pick<
    React.ComponentProps<typeof ContextMenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  );
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal {...props} />;
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>) {
  return <ContextMenuPrimitive.SubmenuRoot {...props} />;
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      className={(state) =>
        cn(
          "flex cursor-default select-none items-center rounded-none px-3 py-2 font-medium text-xs uppercase tracking-wider outline-hidden focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-inset:pl-9.5 data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          typeof className === "function" ? className(state) : className
        )
      }
      data-inset={inset}
      data-slot="context-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

function ContextMenuSubContent({
  side = "right",
  ...props
}: ContextMenuContentProps) {
  return (
    <ContextMenuContent
      data-slot="context-menu-sub-content"
      side={side}
      {...props}
    />
  );
}

function ContextMenuContent({
  className,
  align,
  alignOffset,
  side,
  sideOffset = 4,
  ...props
}: ContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          className={(state) =>
            cn(
              "cn-menu-target cn-menu-translucent data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-none bg-popover p-1.5 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in",
              typeof className === "function" ? className(state) : className
            )
          }
          data-slot="context-menu-content"
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      className={(state) =>
        cn(
          "group/context-menu-item relative flex cursor-default select-none items-center gap-2.5 rounded-none px-3 py-2 font-medium text-xs uppercase tracking-wider outline-hidden focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-inset:pl-9.5 data-[variant=destructive]:text-destructive data-disabled:opacity-50 data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
          typeof className === "function" ? className(state) : className
        )
      }
      data-inset={inset}
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      checked={checked}
      className={(state) =>
        cn(
          "relative flex cursor-default select-none items-center gap-2.5 rounded-none py-2 pr-8 pl-3 font-medium text-xs uppercase tracking-wider outline-hidden focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-inset:pl-9.5 data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          typeof className === "function" ? className(state) : className
        )
      }
      closeOnClick
      data-slot="context-menu-checkbox-item"
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      className={(state) =>
        cn(
          "relative flex cursor-default select-none items-center gap-2.5 rounded-none py-2 pr-8 pl-3 font-medium text-xs uppercase tracking-wider outline-hidden focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-inset:pl-9.5 data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          typeof className === "function" ? className(state) : className
        )
      }
      closeOnClick
      data-slot="context-menu-radio-item"
      {...props}
    >
      <span className="pointer-events-none absolute right-2">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.GroupLabel> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.GroupLabel
      className={(state) =>
        cn(
          "px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider data-inset:pl-9.5",
          typeof className === "function" ? className(state) : className
        )
      }
      data-inset={inset}
      data-slot="context-menu-label"
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={(state) =>
        cn(
          "-mx-1.5 my-1.5 h-px bg-border/50",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ml-auto text-muted-foreground text-xs tracking-widest group-focus/context-menu-item:text-accent-foreground",
        className
      )}
      data-slot="context-menu-shortcut"
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
