/**
 * Spotify to YouTube matching.
 *
 * Scores YouTube search results against a Spotify track by duration, title and
 * artist overlap, and "official upload" signals. Candidates that are too far
 * off in duration or title, or that are an unwanted variant (karaoke,
 * nightcore, sped up...), are rejected outright, so a poor search yields no
 * match rather than the wrong song.
 */

import type {
  SpotifyMatchTrack,
  SpotifyYouTubeCandidate,
  SpotifyYouTubeMatch,
} from "./types.js";

/** Minimum score a candidate needs to be played. */
export const SPOTIFY_MATCH_MIN_SCORE = 0.6;

const MIN_DURATION_TOLERANCE_SECONDS = 15;
const DURATION_TOLERANCE_RATIO = 0.1;
const MIN_TITLE_COVERAGE = 0.5;
const MIN_TITLE_HEAD_PRECISION = 0.6;

const WEIGHT_DURATION = 0.4;
const WEIGHT_TITLE = 0.3;
const WEIGHT_ARTIST = 0.15;
const WEIGHT_OFFICIAL = 0.15;
const TITLE_COVERAGE_SHARE = 0.7;
const SECONDARY_ARTIST_SHARE = 0.5;
const NEUTRAL_DURATION_SCORE = 0.5;
const VARIANT_PENALTY = 0.3;
const VERSION_WORD_WEIGHT = 0.5;

const OFFICIAL_TOPIC = 1;
const OFFICIAL_CHANNEL = 0.9;
const OFFICIAL_TITLE = 0.6;

const MAX_QUERY_LENGTH = 120;

const DIACRITICS_PATTERN = /\p{M}+/gu;
const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;
const AMPERSAND_PATTERN = /&/g;
// "(feat. X)", "[with X]", "(2011 Remaster)", "(Remastered 2009)".
const TITLE_NOISE_GROUP_PATTERN =
  /\s*[([][^)\]]*\b(?:feat\.?|ft\.?|featuring|with|remaster(?:ed)?)\b[^)\]]*[)\]]/giu;
// " - Remastered 2011", " - 2011 Remaster", " - feat. X".
const TITLE_NOISE_SUFFIX_PATTERN =
  /\s+-\s+[^-]*\b(?:feat\.?|ft\.?|featuring|remaster(?:ed)?)\b.*$/iu;
// "(Official Video)", "[4K]": notes, not part of the song's name.
const TITLE_BRACKET_GROUP_PATTERN = /[([][^)\]]*[)\]]/gu;
// " | Vevo", " // Album", "#shorts": trailing notes.
const TITLE_TAIL_PATTERN = /\s+(?:\||\/\/)\s.*$|#.*$/u;
const OFFICIAL_TITLE_PATTERN = /\bofficial\s+(?:audio|video|music\s+video)\b/iu;
const TOPIC_AUTHOR_PATTERN = /\s-\stopic$/iu;
const VEVO_AUTHOR_PATTERN = /vevo$/iu;

// Words in a YouTube title that never describe the studio recording.
const REJECTED_VARIANT_WORDS = new Set([
  "8d",
  "karaoke",
  "nightcore",
  "reaction",
  "slowed",
  "sped",
  "tutorial",
]);
// Words that usually mean a different version, unless Spotify's title has them.
const PENALIZED_VARIANT_WORDS = new Set([
  "acoustic",
  "cover",
  "instrumental",
  "live",
  "remix",
  "reverb",
]);
// Version qualifiers that count half towards title coverage.
const VERSION_WORDS = new Set([
  "album",
  "edit",
  "extended",
  "mix",
  "mono",
  "original",
  "radio",
  "single",
  "stereo",
  "version",
]);
// YouTube title words that say nothing about which song it is.
const NOISE_WORDS = new Set([
  "4k",
  "and",
  "audio",
  "clip",
  "feat",
  "featuring",
  "ft",
  "hd",
  "hq",
  "lyric",
  "lyrics",
  "music",
  "mv",
  "official",
  "remaster",
  "remastered",
  "the",
  "video",
  "visualizer",
  "with",
]);

export type SpotifyCandidateScore = {
  candidate: SpotifyYouTubeCandidate;
  score: number;
  durationDelta?: number;
  /** Why the candidate cannot be played, if it cannot. */
  rejection?: string;
};

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(AMPERSAND_PATTERN, " and ")
    .replace(NON_WORD_PATTERN, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

/** Drops featured-artist and remaster notes from a Spotify title. */
export function cleanSpotifyTitle(title: string): string {
  const cleaned = title
    .replace(TITLE_NOISE_GROUP_PATTERN, "")
    .replace(TITLE_NOISE_SUFFIX_PATTERN, "")
    .trim();
  return cleaned || title.trim();
}

/** The YouTube search query for a Spotify track: primary artist and title. */
export function buildSpotifyYouTubeQuery(track: SpotifyMatchTrack): string {
  const artist = track.artists[0]?.trim() ?? "";
  const query = `${artist} ${cleanSpotifyTitle(track.name)}`.trim();
  return query.slice(0, MAX_QUERY_LENGTH);
}

/** A YouTube title without its bracketed and trailing notes. */
function titleHead(title: string): string {
  return title
    .replace(TITLE_BRACKET_GROUP_PATTERN, " ")
    .replace(TITLE_TAIL_PATTERN, "");
}

function weightedCoverage(
  tokens: readonly string[],
  haystack: ReadonlySet<string>
): number {
  let total = 0;
  let found = 0;
  for (const token of new Set(tokens)) {
    const weight = VERSION_WORDS.has(token) ? VERSION_WORD_WEIGHT : 1;
    total += weight;
    if (haystack.has(token)) {
      found += weight;
    }
  }
  return total === 0 ? 0 : found / total;
}

function artistCoverage(artist: string, haystack: ReadonlySet<string>): number {
  const tokens = tokenize(artist).filter(
    (token) => token !== "the" && token !== "and"
  );
  if (tokens.length === 0) {
    return 0;
  }
  return tokens.every((token) => haystack.has(token)) ? 1 : 0;
}

function scoreArtist(
  artists: readonly string[],
  haystack: ReadonlySet<string>
): number {
  const [primary = "", ...others] = artists;
  const primaryScore = artistCoverage(primary, haystack);
  if (primaryScore > 0) {
    return primaryScore;
  }
  const otherScore = Math.max(
    0,
    ...others.map((artist) => artistCoverage(artist, haystack))
  );
  return otherScore * SECONDARY_ARTIST_SHARE;
}

function scoreOfficial(
  candidate: SpotifyYouTubeCandidate,
  primaryArtist: string
): number {
  const author = candidate.author.trim();
  if (TOPIC_AUTHOR_PATTERN.test(author)) {
    return OFFICIAL_TOPIC;
  }
  const normalizedAuthor = normalize(author);
  if (
    (normalizedAuthor && normalizedAuthor === normalize(primaryArtist)) ||
    VEVO_AUTHOR_PATTERN.test(normalizedAuthor.replaceAll(" ", ""))
  ) {
    return OFFICIAL_CHANNEL;
  }
  return OFFICIAL_TITLE_PATTERN.test(candidate.title) ? OFFICIAL_TITLE : 0;
}

function durationTolerance(duration: number): number {
  return Math.max(
    MIN_DURATION_TOLERANCE_SECONDS,
    duration * DURATION_TOLERANCE_RATIO
  );
}

/** Scores one YouTube candidate against a Spotify track. */
export function scoreYouTubeCandidate(
  track: SpotifyMatchTrack,
  candidate: SpotifyYouTubeCandidate
): SpotifyCandidateScore {
  const reject = (rejection: string, delta?: number) => ({
    candidate,
    durationDelta: delta,
    rejection,
    score: 0,
  });

  // Duration.
  let durationScore = NEUTRAL_DURATION_SCORE;
  let durationDelta: number | undefined;
  if (track.duration !== undefined && track.duration > 0) {
    if (!(candidate.duration && candidate.duration > 0)) {
      return reject("no duration");
    }
    durationDelta = Math.abs(candidate.duration - track.duration);
    const tolerance = durationTolerance(track.duration);
    if (durationDelta > tolerance) {
      return reject("duration too far off", durationDelta);
    }
    durationScore = 1 - durationDelta / tolerance;
  }

  // Title.
  const spotifyTitleTokens = tokenize(cleanSpotifyTitle(track.name));
  const spotifyTitleSet = new Set(spotifyTitleTokens);
  const youtubeTitleTokens = tokenize(candidate.title);
  const youtubeTitleSet = new Set(youtubeTitleTokens);
  const coverage = weightedCoverage(spotifyTitleTokens, youtubeTitleSet);
  if (coverage < MIN_TITLE_COVERAGE) {
    return reject("title does not match", durationDelta);
  }

  const artistTokens = new Set(track.artists.flatMap(tokenize));
  const isSongToken = (token: string) =>
    !(NOISE_WORDS.has(token) || artistTokens.has(token));
  const titlePrecision = (tokens: readonly string[]) =>
    tokens.length === 0
      ? 1
      : tokens.filter((token) => spotifyTitleSet.has(token)).length /
        tokens.length;
  // Another song that only contains this title ("One Love" for "One").
  // Version words are left to the duration check.
  const headSongTokens = tokenize(titleHead(candidate.title)).filter(
    (token) =>
      isSongToken(token) &&
      (spotifyTitleSet.has(token) || !VERSION_WORDS.has(token))
  );
  if (titlePrecision(headSongTokens) < MIN_TITLE_HEAD_PRECISION) {
    return reject("title has extra words", durationDelta);
  }
  const precision = titlePrecision(youtubeTitleTokens.filter(isSongToken));
  const titleScore =
    TITLE_COVERAGE_SHARE * coverage + (1 - TITLE_COVERAGE_SHARE) * precision;

  // Unwanted versions.
  let penalty = 0;
  for (const token of youtubeTitleSet) {
    if (spotifyTitleSet.has(token)) {
      continue;
    }
    if (REJECTED_VARIANT_WORDS.has(token)) {
      return reject(`unwanted variant (${token})`, durationDelta);
    }
    if (PENALIZED_VARIANT_WORDS.has(token)) {
      penalty += VARIANT_PENALTY;
    }
  }

  // Artist, looked up in the channel name and the title.
  const artistHaystack = new Set([
    ...youtubeTitleTokens,
    ...tokenize(candidate.author),
  ]);
  const artistScore = scoreArtist(track.artists, artistHaystack);
  if (artistScore === 0) {
    return reject("artist does not match", durationDelta);
  }

  const officialScore = scoreOfficial(candidate, track.artists[0] ?? "");
  const score =
    WEIGHT_DURATION * durationScore +
    WEIGHT_TITLE * titleScore +
    WEIGHT_ARTIST * artistScore +
    WEIGHT_OFFICIAL * officialScore -
    penalty;

  if (score < SPOTIFY_MATCH_MIN_SCORE) {
    return { candidate, durationDelta, rejection: "score too low", score };
  }
  return { candidate, durationDelta, score };
}

function toMatch(scored: SpotifyCandidateScore): SpotifyYouTubeMatch {
  const { candidate, durationDelta, score } = scored;
  return {
    author: candidate.author,
    duration: candidate.duration,
    durationDelta,
    score: Math.round(score * 1000) / 1000,
    title: candidate.title,
    videoId: candidate.videoId,
  };
}

/**
 * Acceptable candidates, best first. Ties go to the closer duration. Empty
 * when nothing is close enough to play.
 */
export function rankYouTubeCandidates(
  track: SpotifyMatchTrack,
  candidates: readonly SpotifyYouTubeCandidate[]
): SpotifyYouTubeMatch[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.videoId)) {
        return false;
      }
      seen.add(candidate.videoId);
      return true;
    })
    .map((candidate) => scoreYouTubeCandidate(track, candidate))
    .filter((scored) => scored.rejection === undefined)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.durationDelta ?? Number.POSITIVE_INFINITY) -
          (b.durationDelta ?? Number.POSITIVE_INFINITY)
    )
    .map(toMatch);
}

/** The best acceptable candidate, or null when none is close enough. */
export function selectYouTubeMatch(
  track: SpotifyMatchTrack,
  candidates: readonly SpotifyYouTubeCandidate[]
): SpotifyYouTubeMatch | null {
  return rankYouTubeCandidates(track, candidates)[0] ?? null;
}
