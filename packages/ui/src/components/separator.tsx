"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorPrimitive.Props & { decorative?: boolean }) {
  return (
    <SeparatorPrimitive
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      data-slot="separator"
      orientation={orientation}
      role={decorative ? "none" : "separator"}
      {...props}
    />
  );
}

export { Separator };
