import { cleanMetadataText } from "./title-parser";

/** A scheduled broadcast, never a track or a metadata cache lifetime. */
export type RadioProgramme = {
  title: string;
  description: string | null;
  artworkUrl: string | null;
  categories: string[];
  start: number;
  end: number;
};

export type ProgrammePublisher = {
  sampledAt: number;
  onProgrammes?: (programmes: RadioProgramme[]) => void;
};

export const PROGRAMME_HORIZON_MS = 24 * 60 * 60_000;
export const MAX_PROGRAMMES_PER_CHANNEL = 48;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Reject local/ambiguous times and calendar rollover such as February 30. */
export function programmeTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    return null;
  }
  const time = Date.parse(value);
  const wall = Date.parse(`${value.slice(0, 19)}Z`);
  return Number.isFinite(time) &&
    Number.isFinite(wall) &&
    new Date(wall).toISOString().slice(0, 19) === value.slice(0, 19)
    ? time
    : null;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === "string"
    ? cleanMetadataText(value).slice(0, limit) || null
    : null;
}

function artwork(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Shared validity, horizon and size limits for normalized provider schedules. */
export function normalizeProgrammes(
  candidates: readonly Partial<RadioProgramme>[],
  now: number
): RadioProgramme[] {
  const programmes = new Map<string, RadioProgramme>();
  for (const candidate of candidates.slice(0, 512)) {
    const { start, end } = candidate;
    const title = text(candidate.title, 512);
    if (
      !(
        title &&
        typeof start === "number" &&
        typeof end === "number" &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        end - start <= PROGRAMME_HORIZON_MS &&
        end > now &&
        start >= now - PROGRAMME_HORIZON_MS &&
        start < now + PROGRAMME_HORIZON_MS
      )
    ) {
      continue;
    }
    programmes.set(`${start}:${end}`, {
      artworkUrl: artwork(candidate.artworkUrl),
      categories: (candidate.categories ?? [])
        .slice(0, 10)
        .map((category) => text(category, 100))
        .filter((category): category is string => !!category),
      description: text(candidate.description, 8000),
      end,
      start,
      title,
    });
  }
  return [...programmes.values()]
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_PROGRAMMES_PER_CHANNEL);
}

export function publishProgrammes(
  input: ProgrammePublisher,
  candidates: () => readonly Partial<RadioProgramme>[]
): void {
  input.onProgrammes?.(normalizeProgrammes(candidates(), input.sampledAt));
}
