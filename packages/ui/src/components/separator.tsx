"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type * as React from "react";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: Omit<React.ComponentProps<typeof SeparatorPrimitive>, "className"> & {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <SeparatorPrimitive
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
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
