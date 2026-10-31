"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

const { Root, Trigger, Panel: Content } = CollapsiblePrimitive;

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
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0",
        className
      )}
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
