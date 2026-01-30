import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@avoid.quest/ui/components/collapsible";
import { Label } from "@avoid.quest/ui/components/label";
import { Switch } from "@avoid.quest/ui/components/switch";
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

type EffectSectionProps = {
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function EffectSection({
  title,
  enabled,
  onEnabledChange,
  children,
  defaultOpen = false,
}: EffectSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <div className="rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center justify-between p-3">
          <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
            <ChevronDownIcon
              className={`size-4 text-muted-foreground transition-transform ${
                isOpen ? "rotate-0" : "-rotate-90"
              }`}
            />
            <Label className="cursor-pointer font-medium text-sm">
              {title}
            </Label>
          </CollapsibleTrigger>
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <CollapsibleContent>
          <div className="space-y-3 border-border/50 border-t p-3 pt-3">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
