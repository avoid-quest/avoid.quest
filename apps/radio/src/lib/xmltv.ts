import type { PublicStation } from "./kodi-playlist";
import {
  normalizeProgrammes,
  type RadioProgramme,
} from "./metadata/programmes";

const INVALID_XML_CHARACTER =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 forbids these characters even when escaped.
  /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;

function xml(value: string): string {
  return value
    .replace(INVALID_XML_CHARACTER, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function timestamp(value: number): string {
  return `${new Date(value).toISOString().slice(0, 19).replaceAll(/[-:T]/g, "")} +0000`;
}

/** XMLTV element order follows xmltv.dtd; all instants are explicit UTC. */
export function renderXmltv(
  stations: PublicStation[],
  schedules: ReadonlyMap<string, RadioProgramme[]>,
  now: number
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="avoid radio">',
  ];
  for (const station of stations) {
    lines.push(
      `<channel id="${xml(station.id)}"><display-name>${xml(station.name)}</display-name>${station.logoUrl ? `<icon src="${xml(station.logoUrl)}"/>` : ""}</channel>`
    );
  }
  for (const station of stations) {
    for (const programme of normalizeProgrammes(
      schedules.get(station.id) ?? [],
      now
    )) {
      lines.push(
        `<programme start="${timestamp(programme.start)}" stop="${timestamp(programme.end)}" channel="${xml(station.id)}">`,
        `<title>${xml(programme.title)}</title>`
      );
      if (programme.description) {
        lines.push(`<desc>${xml(programme.description)}</desc>`);
      }
      for (const category of programme.categories) {
        lines.push(`<category>${xml(category)}</category>`);
      }
      if (programme.artworkUrl) {
        lines.push(`<icon src="${xml(programme.artworkUrl)}"/>`);
      }
      lines.push("</programme>");
    }
  }
  return `${lines.join("\n")}\n</tv>\n`;
}
