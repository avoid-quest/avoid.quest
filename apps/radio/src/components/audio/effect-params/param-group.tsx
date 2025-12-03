import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";

type ParamGroupProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export function ParamGroup({ title, children, className }: ParamGroupProps) {
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
