import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { resolvePlatformItem } from "@/lib/platform-client";
import { createExternalStationResolutionWorkflow } from "@/lib/stations/external-station-workflow";

function createRadioGardenResolveAdapter() {
  return async (_channelId: string, canonicalUrl: string) => {
    try {
      const resolved = await resolvePlatformItem(canonicalUrl);
      return {
        ok: true as const,
        data: { format: resolved.format, streamUrl: resolved.streamUrl },
      };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: "RADIO_GARDEN_RESOLVER_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to resolve Radio Garden stream",
        },
      };
    }
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

  const selectDiscoveredStation = (radio: Radio) => {
    addSessionRadio(radio);
    Promise.resolve()
      .then(() => onResolved(radio))
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to select station"
        );
      });
  };

  return {
    resolve: resolveMutation.mutate,
    saveToCollection,
    selectDiscoveredStation,
    isResolving: resolveMutation.isPending,
  };
}
