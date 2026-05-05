import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { createExternalStationResolutionWorkflow } from "@/lib/stations/external-station-workflow";
import { radioGardenResolveStream } from "@/utils/radio-garden.functions";

function createRadioGardenResolveAdapter() {
  return async (channelId: string) => {
    const response = await radioGardenResolveStream({
      data: { channelId },
    });
    if (!response.ok) {
      return {
        ok: false as const,
        error: {
          code: response.error.code,
          message: response.error.message,
        },
      };
    }

    return {
      ok: true as const,
      data: {
        streamUrl: response.data.streamUrl,
      },
    };
  };
}

export function useRadioGardenResolve(
  onResolved: (radio: Radio) => void | Promise<void>
) {
  const addSessionRadio = useSessionRadios((s) => s.addSessionRadio);
  const removeSessionRadio = useSessionRadios((s) => s.removeSessionRadio);
  const workflow = createExternalStationResolutionWorkflow({
    adapters: {
      radioGarden: {
        resolveStream: createRadioGardenResolveAdapter(),
      },
    },
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

  const resolveMutation = useMutation({
    mutationFn: async (result: RadioGardenSearchResult): Promise<Radio> => {
      const resolved = await workflow.resolveRadioGardenToSession(result);
      if (!resolved.ok) {
        throw new Error(resolved.error.message);
      }

      return resolved.data.radio;
    },
    onSuccess: (radio) => onResolved(radio),
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const saveToCollection = (result: RadioGardenSearchResult) => {
    workflow.resolveRadioGardenToCollection(result).then((resolved) => {
      if (!resolved.ok) {
        toast.error(resolved.error.message);
        return;
      }
      toast.success(`Saved "${result.title}" to collection`);
    });
  };

  return {
    resolve: resolveMutation.mutate,
    saveToCollection,
    isResolving: resolveMutation.isPending,
  };
}
