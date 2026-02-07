import { Button } from "@avoid.quest/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { Separator } from "@avoid.quest/ui/components/separator";
import { Settings } from "lucide-react";
import { AudioTab } from "./audio-tab";
import { EffectsTab } from "./effects-tab";
import { QualitySelect } from "./quality-select";
import { ScrollSensitivitySlider } from "./scroll-sensitivity-slider";
import { UsernameField } from "./username-field";

export function SettingsPanel() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="fixed top-4 right-4 z-50 bg-black/50 backdrop-blur hover:bg-black/70"
          size="icon"
          variant="outline"
        >
          <Settings className="h-5 w-5" />
          <span className="sr-only">Settings</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-80 overflow-y-auto">
        <div className="flex flex-col gap-4">
          <h3 className="font-medium">Settings</h3>
          <UsernameField />
          <QualitySelect />
          <ScrollSensitivitySlider />
          <Separator />
          <AudioTab />
          <Separator />
          <EffectsTab />
        </div>
      </PopoverContent>
    </Popover>
  );
}
