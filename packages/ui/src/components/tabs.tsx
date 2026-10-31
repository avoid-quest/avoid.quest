"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: Omit<TabsPrimitive.Root.Props, "className"> & { className?: string }) {
  return (
    <TabsPrimitive.Root
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      data-orientation={orientation}
      data-slot="tabs"
      orientation={orientation}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center p-1 text-muted-foreground group-data-[orientation=horizontal]/tabs:h-10 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function TabsList({
  className,
  variant = "default",
  ...props
}: Omit<TabsPrimitive.List.Props, "className"> & {
  className?: string;
} & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      activateOnFocus
      className={cn(tabsListVariants({ variant }), className)}
      data-slot="tabs-list"
      data-variant={variant}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: Omit<TabsPrimitive.Tab.Props, "className"> & { className?: string }) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 whitespace-nowrap border border-transparent px-4 py-1.5 font-semibold text-foreground/60 text-xs uppercase tracking-wider transition-all hover:text-foreground focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:px-4 group-data-[orientation=vertical]/tabs:py-2 dark:text-muted-foreground dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: Omit<TabsPrimitive.Panel.Props, "className"> & { className?: string }) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 text-sm outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
