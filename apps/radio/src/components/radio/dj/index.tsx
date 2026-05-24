import { getDjRadios } from "@/lib/dj-radios";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { DjPlayer } from "./dj-player";

export function Dj() {
  const { data: radioRecords } = useAllRadios();
  const radios = getDjRadios(radioRecords);

  return <DjPlayer radios={radios} />;
}
