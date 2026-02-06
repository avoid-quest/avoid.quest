import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { DjPlayer } from "./dj/dj-player";
import { MultipleRadios } from "./multiple";
import { SingleRadio } from "./single";

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();

  const enabledRadios = radios ?? [];

  if (settings?.player.mode === "single") {
    return <SingleRadio radios={enabledRadios} />;
  }
  if (settings?.player.mode === "dj") {
    return <DjPlayer radios={enabledRadios} />;
  }
  return <MultipleRadios radios={enabledRadios} />;
}
