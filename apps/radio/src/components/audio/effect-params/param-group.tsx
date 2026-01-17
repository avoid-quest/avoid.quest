import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
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
        className={cn("space-y-2", className)}
        onOpenChange={setOpen}
        open={open}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between">
          <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            {title}
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
        <Separator />
        <CollapsibleContent>
          <div className="space-y-4 pt-2">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {title?.trim() !== "" && (
        <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {title}
        </div>
      )}
      <Separator />
      <div className="space-y-4">{children}</div>
    </div>
  );
}
