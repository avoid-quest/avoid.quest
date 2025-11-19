"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DjPlayer } from "./dj/dj-player";
import { MultipleRadios } from "./multiple";
import { SingleRadio } from "./single";
export function Radios() {
  const radios = useLiveQuery(
    async () => await db.radios.orderBy("order").toArray()
  );
  const settings = useLiveQuery(() => db.settings.limit(1).toArray())?.[0];

  // Filter out disabled radios
  const enabledRadios =
    radios?.filter((radio) => radio.enabled !== false) ?? [];

  if (settings?.player.mode === "single") {
    return <SingleRadio radios={enabledRadios} />;
  }
  if (settings?.player.mode === "dj") {
    return <DjPlayer radios={enabledRadios} />;
  }
  return <MultipleRadios radios={enabledRadios} />;
}
