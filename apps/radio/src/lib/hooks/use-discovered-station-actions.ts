import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { stationIntake } from "@/lib/stations/external-station-workflow";
import { notifyStationSave } from "@/lib/stations/station-save-notification";

export function useDiscoveredStationActions(
  onSelected: (radio: Radio) => void | Promise<void>
) {
  const selectDiscoveredStation = (radio: Radio) => {
    stationIntake
      .createSession({ origin: "discovery", radio })
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        return onSelected(result.data.radio);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to select station"
        );
      });
  };

  const saveDiscoveredStation = (radio: Radio) => {
    stationIntake
      .save({ origin: "discovery", radio })
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        notifyStationSave(
          result.data,
          `Saved "${result.data.radio.name}" to collection`
        );
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to save station"
        );
      });
  };

  return { saveDiscoveredStation, selectDiscoveredStation };
}
