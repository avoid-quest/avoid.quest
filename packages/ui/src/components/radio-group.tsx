"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type * as React from "react";

function RadioGroup<Value extends string = string>({
  className,
  ...props
}: Omit<RadioGroupPrimitive.Props<Value>, "className"> & {
  className?: string;
}) {
  return (
    <RadioGroupPrimitive
      className={cn("grid w-full gap-3", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Radio.Root>, "className"> & {
  className?: string;
}) {
  return (
    <Radio.Root
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4.5 shrink-0 rounded-full border border-input bg-transparent outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 group-has-[:focus-visible]/field-label:not-data-checked:border-input group-has-[:focus-visible]/field-label:ring-0 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-foreground data-checked:border-foreground group-has-[:focus-visible]/field-label:data-checked:border-foreground dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      data-slot="radio-group-item"
      nativeButton
      render={<button type="button" />}
      {...props}
    >
      <Radio.Indicator
        className="flex size-4.5 items-center justify-center"
        data-slot="radio-group-indicator"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
      </Radio.Indicator>
    </Radio.Root>
  );
}

export { RadioGroup, RadioGroupItem };
