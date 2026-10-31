import { cn } from "@avoid.quest/ui/lib/utils";

/**
 * The one way an inline error looks anywhere in the app. Light mode outlines
 * rather than tints it: on the tint, destructive text falls below 4.5:1.
 */
export function InlineError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-md border border-destructive/30 px-2.5 py-1.5 text-destructive text-xs dark:border-transparent dark:bg-destructive/10",
        className
      )}
      role="alert"
    >
      {children}
    </p>
  );
}
