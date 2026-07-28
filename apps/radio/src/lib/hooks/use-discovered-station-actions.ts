import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { createExternalStationResolutionWorkflow } from "@/lib/stations/external-station-workflow";

export function useDiscoveredStationActions(
  onSelected: (radio: Radio) => void | Promise<void>
) {
  const addSessionRadio = useSessionRadios((state) => state.addSessionRadio);
  const removeSessionRadio = useSessionRadios(
    (state) => state.removeSessionRadio
  );
  const workflow = createExternalStationResolutionWorkflow({
    adapters: {},
    collection: {
      addSavedRadio: addRadio,
      getSavedRadios: () => radiosCollection.state.values(),
    },
    session: {
      addSessionRadio,
      getSessionRadios: () => useSessionRadios.getState().radios,
      removeSessionRadio,
    },
  });

  const selectDiscoveredStation = (radio: Radio) => {
    addSessionRadio(radio);
    Promise.resolve(onSelected(radio)).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to select station"
      );
    });
  };

  const saveDiscoveredStation = (radio: Radio) => {
    const sessionRadio = useSessionRadios
      .getState()
      .radios.find((candidate) => candidate.id === radio.id);
    workflow.saveRadioToCollection(sessionRadio ?? radio, {
      removeSessionRadioId: sessionRadio?.id,
    });
    toast.success(`Saved "${radio.name}" to collection`);
  };

  return { saveDiscoveredStation, selectDiscoveredStation };
}
