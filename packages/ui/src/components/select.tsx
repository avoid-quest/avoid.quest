/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
  IconCheck as CheckIcon,
  IconChevronDown as ChevronDownIcon,
  IconChevronUp as ChevronUpIcon,
} from "@tabler/icons-react";
import type * as React from "react";

function Select<Value = string, Multiple extends boolean | undefined = false>(
  props: SelectPrimitive.Root.Props<Value, Multiple>
) {
  return <SelectPrimitive.Root {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /** "xs" is the dense h-7 row used inside DJ panels and effect cards. */
  size?: "xs" | "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      className={(state) =>
        cn(
          "flex w-fit items-center justify-between gap-1.5 whitespace-nowrap rounded-none border border-transparent border-b-input bg-transparent px-0 py-2 text-sm outline-none transition-[color,border-color] focus-visible:border-b-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive data-[size=default]:h-10 data-[size=sm]:h-9 data-[size=xs]:h-7 data-[size=xs]:px-2.5 data-[size=xs]:text-xs data-placeholder:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-b-destructive/50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          typeof className === "function" ? className(state) : className
        )
      }
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="size-4 opacity-50" />}
      />
    </SelectPrimitive.Trigger>
  );
}

type SelectContentProps = React.ComponentProps<typeof SelectPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >;

function SelectContent({
  className,
  children,
  align = "center",
  alignOffset,
  side,
  sideOffset = 4,
  alignItemWithTrigger = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={(state) =>
            cn(
              "cn-menu-target cn-menu-translucent data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-none bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-closed:animate-out data-open:animate-in",
              typeof className === "function" ? className(state) : className
            )
          }
          data-slot="select-content"
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="max-h-(--available-height) overflow-y-auto p-1"
          >
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      className={(state) =>
        cn(
          "px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="select-label"
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={(state) =>
        cn(
          "relative flex w-full cursor-default select-none items-center gap-2.5 rounded-none py-2 pr-8 pl-3 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="select-item"
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={(state) =>
        cn(
          "pointer-events-none -mx-1.5 my-1.5 h-px bg-border/50",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      className={(state) =>
        cn(
          "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="select-scroll-up-button"
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      className={(state) =>
        cn(
          "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
          typeof className === "function" ? className(state) : className
        )
      }
      data-slot="select-scroll-down-button"
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
