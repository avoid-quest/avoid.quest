import { useAllRadios } from "@/lib/hooks/use-radios";
import { DjPlayer } from "./dj-player";

export function Dj() {
  const { data: radioRecords } = useAllRadios();
  // Convert RadioRecord[] to Radio[] for component compatibility
  const radios =
    radioRecords?.map((r) => ({
      ...r,
      id: Number(r.id) || Date.now(),
    })) ?? [];

  return <DjPlayer radios={radios} />;
}
