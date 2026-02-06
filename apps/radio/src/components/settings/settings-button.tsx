import { Button } from "@avoid.quest/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@avoid.quest/ui/components/drawer";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Settings2Icon } from "lucide-react";
import { useState } from "react";
import { SettingsForm } from "./settings-form";

type SettingsButtonProps = {
  defaultTab?: string;
  className?: string;
};

export function SettingsButton({ defaultTab, className }: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer handleOnly={true} onOpenChange={setIsOpen} open={isOpen}>
      <DrawerTrigger asChild>
        <Button
          className={cn("size-7", className)}
          size="icon"
          variant="outline"
        >
          <Settings2Icon className="size-3.5" />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto w-full max-w-4xl">
          <DrawerHeader className="pb-4">
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription>
              Manage your radio stations and player settings.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <SettingsForm defaultTab={defaultTab} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
