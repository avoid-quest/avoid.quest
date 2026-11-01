import { cn } from "@avoid.quest/ui/lib/utils";
import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      className={cn(
        "h-10 w-full min-w-0 border border-transparent border-b-input bg-transparent px-0 py-1 text-base outline-none transition-[color,border-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:border-b-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive md:text-sm dark:aria-invalid:border-b-destructive/50",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
