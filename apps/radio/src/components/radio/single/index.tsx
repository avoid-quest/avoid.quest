import type { Radio } from "@/lib/types";
import { SinglePlayer } from "./single-player";

export function SingleRadio({ radios }: { radios?: Radio[] }) {
  return <SinglePlayer radios={radios} />;
}
