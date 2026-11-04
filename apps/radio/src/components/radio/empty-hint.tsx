import {
  Empty,
  EmptyDescription,
  EmptyMedia,
} from "@avoid.quest/ui/components/empty";
import { cn } from "@avoid.quest/ui/lib/utils";

/** The compact empty state, with an optional icon and action. */
export function EmptyHint({
  action,
  icon,
  children,
  className,
}: {
  action?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("flex-none gap-3 p-6 md:p-6", className)}>
      {icon ? (
        <EmptyMedia className="mb-0 text-muted-foreground/40 [&_svg:not([class*='size-'])]:size-8">
          {icon}
        </EmptyMedia>
      ) : null}
      <EmptyDescription className="text-xs">{children}</EmptyDescription>
      {action}
    </Empty>
  );
}
