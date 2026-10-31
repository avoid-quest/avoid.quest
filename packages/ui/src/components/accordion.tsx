"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";

import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";

function Accordion({
  className,
  ...props
}: Omit<AccordionPrimitive.Root.Props, "className"> & { className?: string }) {
  return (
    <AccordionPrimitive.Root
      className={cn("flex w-full flex-col", className)}
      data-slot="accordion"
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: Omit<AccordionPrimitive.Item.Props, "className"> & { className?: string }) {
  return (
    <AccordionPrimitive.Item
      className={cn("not-last:border-b", className)}
      data-slot="accordion-item"
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: Omit<AccordionPrimitive.Trigger.Props, "className"> & {
  className?: string;
}) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between gap-6 rounded-none border border-transparent py-4 text-left font-semibold text-sm outline-none transition-all hover:underline focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-3.5 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className
        )}
        data-slot="accordion-trigger"
        {...props}
      >
        {children}
        <IconChevronDown
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
          data-slot="accordion-trigger-icon"
        />
        <IconChevronUp
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
          data-slot="accordion-trigger-icon"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: Omit<AccordionPrimitive.Panel.Props, "className"> & { className?: string }) {
  return (
    <AccordionPrimitive.Panel
      className="h-(--accordion-panel-height) overflow-hidden text-sm transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0"
      data-slot="accordion-content"
      {...props}
    >
      <div
        className={cn(
          "pt-0 pb-4 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
