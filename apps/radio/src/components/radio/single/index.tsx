import type { Radio } from "@avoid.quest/cacophony";
import { SinglePlayer } from "./single-player";

export function SingleRadio({ radios }: { radios?: Radio[] }) {
  return <SinglePlayer radios={radios} />;
}
