import { Button } from "@workspace/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@workspace/ui/components/drawer";
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { SettingsForm } from "./settings-form";

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer handleOnly={true} onOpenChange={setIsOpen} open={isOpen}>
      <DrawerTrigger asChild>
        <Button size="icon" variant="outline">
          <Settings2 className="size-4" />
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
            <SettingsForm />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
