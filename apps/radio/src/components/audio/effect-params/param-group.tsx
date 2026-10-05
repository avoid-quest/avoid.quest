import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@avoid.quest/ui/components/collapsible";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

type ParamGroupProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Make the group collapsible. Default: false */
  collapsible?: boolean;
  /** Default open state when collapsible. Default: true */
  defaultOpen?: boolean;
};

const titleClassName =
  "font-mono text-[10px] text-muted-foreground uppercase tracking-wider";
const rowClassName = "flex flex-wrap items-start gap-x-2 gap-y-3";

export function ParamGroup({
  title,
  children,
  className,
  collapsible = false,
  defaultOpen = true,
}: ParamGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (collapsible && title?.trim()) {
    return (
      <Collapsible
        className={cn("basis-full border-border/50 border-t pt-2", className)}
        onOpenChange={setOpen}
        open={open}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={titleClassName}>{title}</span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn(rowClassName, "pt-2")}>{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        "min-w-[9rem] flex-1 border-border/50 border-t pt-2",
        className
      )}
    >
      {title?.trim() ? <div className={titleClassName}>{title}</div> : null}
      <div className={cn(rowClassName, title?.trim() && "pt-2")}>
        {children}
      </div>
    </div>
  );
}
