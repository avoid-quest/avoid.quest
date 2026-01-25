import { Button } from "@avoid.quest/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@avoid.quest/ui/components/drawer";
import { Settings } from "lucide-react";
import { QualitySelect } from "./quality-select";
import { UsernameField } from "./username-field";

export function SettingsDrawer() {
  return (
    <Drawer direction="right">
      <DrawerTrigger asChild>
        <Button
          className="fixed top-4 right-4 z-50 bg-black/50 backdrop-blur hover:bg-black/70"
          size="icon"
          variant="outline"
        >
          <Settings className="h-5 w-5" />
          <span className="sr-only">Settings</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Settings</DrawerTitle>
          <DrawerDescription>Configure gallery options</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-6 p-4">
          <UsernameField />
          <QualitySelect />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
