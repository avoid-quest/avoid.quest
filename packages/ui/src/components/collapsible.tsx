"use client";

import {
  CollapsibleContent as Content,
  Root,
  CollapsibleTrigger as Trigger,
} from "@radix-ui/react-collapsible";
import { cn } from "../lib/utils";

function Collapsible({ ...props }: React.ComponentProps<typeof Root>) {
  return <Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof Trigger>) {
  return <Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof Content>) {
  return (
    <Content
      className={cn(
        "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className
      )}
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
