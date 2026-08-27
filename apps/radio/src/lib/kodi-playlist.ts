import type { Radio } from "./types";

export const KODI_DEFAULT_GROUP_TITLE = "avoid radio";

type KodiStation = {
  id: string;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  groupTitle: string;
  order: number;
};

export type PublicStation = {
  id: string;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  groupTitle: string;
  order: number;
};

function cleanM3uText(value: string): string {
  return value
    .replaceAll(/[\r\n]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function cleanM3uAttribute(value: string): string {
  return cleanM3uText(value).replaceAll('"', "'");
}

function toKodiTvgName(name: string): string {
  return cleanM3uText(name).replaceAll(/\s+/g, "_");
}

function toStableStationId(radio: Radio): string {
  if (radio.id !== undefined && radio.id !== null) {
    return `avoid-radio-${String(radio.id).toLowerCase()}`;
  }

  const slug = cleanM3uText(radio.name)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return `avoid-radio-${slug || "station"}`;
}

function isPublicPlayableUrl(streamUrl: string): boolean {
  const trimmedUrl = streamUrl.trim();
  if (!trimmedUrl) {
    return false;
  }

  try {
    const parsed = new URL(trimmedUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPublicLogoUrl(logoUrl: string | undefined): logoUrl is string {
  if (!logoUrl) {
    return false;
  }

  try {
    const parsed = new URL(logoUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toKodiStation(
  radio: Radio,
  groupTitle = KODI_DEFAULT_GROUP_TITLE
): KodiStation | null {
  const name = cleanM3uText(radio.name);
  const streamUrl = radio.streamUrl.trim();

  if (!name || radio.enabled === false || !isPublicPlayableUrl(streamUrl)) {
    return null;
  }

  const station: KodiStation = {
    groupTitle: cleanM3uText(groupTitle) || KODI_DEFAULT_GROUP_TITLE,
    id: toStableStationId(radio),
    name,
    order: radio.order ?? Number.MAX_SAFE_INTEGER,
    streamUrl,
  };

  if (isPublicLogoUrl(radio.logoUrl)) {
    station.logoUrl = radio.logoUrl.trim();
  }

  return station;
}

export function getPublicKodiStations(
  radios: Radio[],
  groupTitle = KODI_DEFAULT_GROUP_TITLE
): PublicStation[] {
  return radios
    .map((radio) => toKodiStation(radio, groupTitle))
    .filter((station): station is KodiStation => station !== null)
    .sort(
      (left, right) =>
        left.order - right.order || left.name.localeCompare(right.name)
    )
    .map((station) => ({ ...station }));
}

function renderExtinf(station: PublicStation): string {
  const attributes = [
    ["tvg-id", station.id],
    ["tvg-name", toKodiTvgName(station.name)],
    ["group-title", station.groupTitle],
    ["radio", "true"],
  ];

  if (station.logoUrl) {
    attributes.splice(2, 0, ["tvg-logo", station.logoUrl]);
  }

  const renderedAttributes = attributes
    .map(([key, value]) => `${key}="${cleanM3uAttribute(value)}"`)
    .join(" ");

  return `#EXTINF:-1 ${renderedAttributes},${cleanM3uText(station.name)}`;
}

export function renderKodiM3uPlaylist(stations: PublicStation[]): string {
  const lines = ["#EXTM3U"];

  for (const station of stations) {
    lines.push(renderExtinf(station), station.streamUrl);
  }

  return `${lines.join("\n")}\n`;
}
