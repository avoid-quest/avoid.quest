"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type * as React from "react";

function Switch({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "className"> & {
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-none border outline-none transition-all after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 group-has-[:focus-visible]/field-label:ring-0 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=default]:h-4.5 data-[size=sm]:h-3.5 data-[size=default]:w-8.25 data-[size=sm]:w-6.25 data-disabled:cursor-not-allowed data-checked:border-primary data-unchecked:border-input/50 data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-50 group-has-[:focus-visible]/field-label:data-checked:border-primary group-has-[:focus-visible]/field-label:data-unchecked:border-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      data-size={size}
      data-slot="switch"
      nativeButton
      render={<button type="button" />}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block bg-background ring-0 transition-transform data-checked:translate-x-[calc(100%+2px)] data-unchecked:translate-x-0.25 group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
