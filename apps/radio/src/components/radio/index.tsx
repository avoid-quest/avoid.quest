import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { DjPlayer } from "./dj/dj-player";
import { MultipleRadios } from "./multiple";
import { SingleRadio } from "./single";

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();

  // Map to Radio type expected by components
  // Use string id directly - UUID strings work as keys
  const enabledRadios =
    radios?.map((r) => ({
      ...r,
      id: r.id,
    })) ?? [];

  if (settings?.player.mode === "single") {
    return <SingleRadio radios={enabledRadios} />;
  }
  if (settings?.player.mode === "dj") {
    return <DjPlayer radios={enabledRadios} />;
  }
  return <MultipleRadios radios={enabledRadios} />;
}
