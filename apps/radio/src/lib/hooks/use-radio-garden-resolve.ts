import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import {
  addResolvedStationToSession,
  resolveRadioGardenStation,
  saveResolvedStationToCollection,
} from "@/lib/stations/external-station-workflow";
import { radioGardenResolveStream } from "@/utils/radio-garden.functions";

export function useRadioGardenResolve(
  onResolved: (radio: Radio) => void | Promise<void>
) {
  const addSessionRadio = useSessionRadios((s) => s.addSessionRadio);
  const removeSessionRadio = useSessionRadios((s) => s.removeSessionRadio);

  const resolveMutation = useMutation({
    mutationFn: async (result: RadioGardenSearchResult): Promise<Radio> => {
      const resolved = await resolveRadioGardenStation(
        result,
        async (channelId) => {
          const response = await radioGardenResolveStream({
            data: { channelId },
          });
          if (!response.ok) {
            return {
              ok: false,
              error: {
                code: response.error.code,
                message: response.error.message,
              },
            };
          }

          return {
            ok: true,
            data: {
              streamUrl: response.data.streamUrl,
            },
          };
        }
      );
      if (!resolved.ok) {
        throw new Error(resolved.error.message);
      }

      return resolved.data;
    },
    onSuccess: async (radio) => {
      addResolvedStationToSession(radio, addSessionRadio);
      await onResolved(radio);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const saveToCollection = (result: RadioGardenSearchResult) => {
    const sessionRadios = useSessionRadios.getState().radios;
    const sessionRadio = sessionRadios.find(
      (r) => r.id === `rg_${result.channelId}`
    );

    if (sessionRadio) {
      saveResolvedStationToCollection(
        sessionRadio,
        {
          addSavedRadio: addRadio,
          getSavedRadios: () => radiosCollection.state.values(),
          removeSessionRadio,
        },
        { removeSessionRadioId: sessionRadio.id }
      );
      toast.success(`Saved "${result.title}" to collection`);
      return;
    }

    resolveRadioGardenStation(result, async (channelId) => {
      const response = await radioGardenResolveStream({
        data: { channelId },
      });
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: response.error.code,
            message: response.error.message,
          },
        };
      }

      return {
        ok: true,
        data: {
          streamUrl: response.data.streamUrl,
        },
      };
    }).then((resolved) => {
      if (!resolved.ok) {
        toast.error(resolved.error.message);
        return;
      }

      saveResolvedStationToCollection(resolved.data, {
        addSavedRadio: addRadio,
        getSavedRadios: () => radiosCollection.state.values(),
      });
      toast.success(`Saved "${result.title}" to collection`);
    });
  };

  return {
    resolve: resolveMutation.mutate,
    saveToCollection,
    isResolving: resolveMutation.isPending,
  };
}
