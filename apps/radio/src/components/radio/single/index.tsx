import type { Radio } from "@/lib/audio";
import { SinglePlayer } from "./single-player";

export function SingleRadio({ radios }: { radios?: Radio[] }) {
  return <SinglePlayer radios={radios} />;
}
