import { radioRecordsToDjRadios } from "@/lib/dj/radio-records";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { DjPlayer } from "./dj-player";

export function Dj() {
  const { data: radioRecords } = useAllRadios();
  const radios = radioRecordsToDjRadios(radioRecords);

  return <DjPlayer radios={radios} />;
}
