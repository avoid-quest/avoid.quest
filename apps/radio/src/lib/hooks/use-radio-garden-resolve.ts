import type { RadioGardenSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { addRadio } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import { radioGardenResolveStream } from "@/utils/radio-garden.functions";

function resultToRadio(
  result: RadioGardenSearchResult,
  streamUrl: string
): Radio {
  return {
    id: `rg_${result.channelId}`,
    name: result.title,
    streamUrl,
    description: result.subtitle,
    placeTitle: result.placeTitle,
    countryTitle: result.countryTitle,
    websiteUrl: result.website,
    enabled: true,
    isSystem: false,
    platformMetadata: {
      platform: "radiogarden",
      itemType: "channel",
      url: result.url,
      channelId: result.channelId,
      name: result.title,
      subtitle: result.subtitle,
      placeTitle: result.placeTitle,
      countryTitle: result.countryTitle,
      website: result.website,
    },
  };
}

export function useRadioGardenResolve(
  onResolved: (radio: Radio) => void | Promise<void>
) {
  const addSessionRadio = useSessionRadios((s) => s.addSessionRadio);

  const resolveMutation = useMutation({
    mutationFn: async (
      result: RadioGardenSearchResult
    ): Promise<{ radio: Radio; result: RadioGardenSearchResult }> => {
      const response = await radioGardenResolveStream({
        data: { channelId: result.channelId },
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const radio = resultToRadio(result, response.streamUrl);
      return { radio, result };
    },
    onSuccess: async ({ radio }) => {
      addSessionRadio(radio);
      await onResolved(radio);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const saveToCollection = (result: RadioGardenSearchResult) => {
    // Find session radio for this result
    const sessionRadios = useSessionRadios.getState().radios;
    const sessionRadio = sessionRadios.find(
      (r) => r.id === `rg_${result.channelId}`
    );

    if (sessionRadio) {
      // Already resolved — save directly
      const { id: _id, ...radioData } = sessionRadio;
      addRadio({
        ...radioData,
        name: radioData.name,
        streamUrl: radioData.streamUrl,
        order: 0,
        enabled: true,
        isSystem: false,
      });
      if (sessionRadio.id) {
        useSessionRadios.getState().removeSessionRadio(sessionRadio.id);
      }
      toast.success(`Saved "${result.title}" to collection`);
      return;
    }

    // Not yet resolved — resolve first, then save
    radioGardenResolveStream({
      data: { channelId: result.channelId },
    }).then((response) => {
      if (!response.success) {
        toast.error(response.error);
        return;
      }
      const radio = resultToRadio(result, response.streamUrl);
      const { id: _id, ...radioData } = radio;
      addRadio({
        ...radioData,
        order: 0,
        enabled: true,
        isSystem: false,
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
