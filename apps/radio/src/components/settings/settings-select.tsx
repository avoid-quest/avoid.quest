import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { toast } from "sonner";
import { setPlayerType } from "@/lib/collections";
import { useSettings } from "@/lib/hooks/use-settings";
import { playerTypes } from "@/lib/types";
import { ModeSelect } from "./mode-select";

export function SettingsSelect() {
  const { data: settings } = useSettings();

  const handlePlayerTypeChange = (value: string) => {
    if (!settings) {
      return;
    }

    try {
      setPlayerType(value as "default" | "browser");
    } catch (error) {
      console.error("Failed to update player type:", error);
      toast.error("Failed to update player type");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="font-medium text-sm">Player Type</div>
        <Select
          onValueChange={handlePlayerTypeChange}
          value={settings?.player.playerType ?? "default"}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a player type" />
          </SelectTrigger>
          <SelectContent>
            {playerTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="font-medium text-sm">Player Mode</div>
        <ModeSelect className="max-w-full" />
      </div>
    </div>
  );
}
