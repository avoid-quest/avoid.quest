import { cn } from "@avoid.quest/ui/lib/utils";

/** The one way an inline error looks anywhere in the app. */
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
        "rounded-md bg-destructive/10 px-2.5 py-1.5 text-destructive text-xs",
        className
      )}
      role="alert"
    >
      {children}
    </p>
  );
}
