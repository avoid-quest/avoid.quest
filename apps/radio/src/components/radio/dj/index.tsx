import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DjPlayer } from "./dj-player";

export function Dj() {
  const radios = useLiveQuery(() => db.radios.toArray()) ?? [];

  return <DjPlayer radios={radios} />;
}
