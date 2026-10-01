import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ChangelogEntry } from "@avoid.quest/ui/lib/changelog";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:changelog";
/** Build-time global: the newest entry's date, or null with no entries. */
const NEWEST_DATE_GLOBAL = "__CHANGELOG_NEWEST_DATE__";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const GIT_LOG_FORMAT = "%H%x1f%cI%x1f%s%x1f%b%x1e";
// Commits read per build; far more than `limit` so filtering still fills it.
const SCAN_COUNT = 400;
// A shallow CI clone is deepened this far before reading history.
const DEEPEN_COUNT = 500;

const CONVENTIONAL_SUBJECT = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;
const PULL_REQUEST_SUFFIX = /\s*\(#\d+\)$/;
const CHANGELOG_LINE = /^changelog:[ \t]*(.*)$/im;
const CHANGELOG_LINES = /^changelog:[ \t]*(.*)$/gim;
const CHANGELOG_SINCE = /^changelog-since:[ \t]*([0-9a-f]{4,40})[ \t]*$/im;
const REVERTED_COMMIT = /This reverts commit ([0-9a-f]{40})/g;
// Where a squash merge starts listing the commits it squashed.
const SQUASHED_COMMITS = /^\* /m;
const HIDDEN_VALUES = new Set(["-", "no", "none", "skip"]);

export type GitChangelogOptions = {
  /** Conventional commit types listed without a `Changelog:` line. */
  types?: string[];
  limit?: number;
};

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Commit = { body: string; date: string; hash: string; subject: string };

/**
 * Hashes of commits undone by a revert that is itself still in effect, so a
 * reverted revert restores what it had removed. `commits` is newest first,
 * and a revert is always newer than what it reverts.
 */
function findRevertedCommits(commits: Commit[]) {
  const reverted = new Set<string>();
  for (const { body, hash } of commits) {
    if (reverted.has(hash)) {
      continue;
    }
    for (const match of body.matchAll(REVERTED_COMMIT)) {
      if (match[1]) {
        reverted.add(match[1]);
      }
    }
  }
  return reverted;
}

/**
 * The part of a commit message that is its own. In a squash merge (a subject
 * ending in `(#123)`), lines inside the list of squashed commits belong to
 * those commits, so only the lines above that list count.
 */
function readOwnBody({ body, subject }: Commit) {
  return (
    (PULL_REQUEST_SUFFIX.test(subject)
      ? body.split(SQUASHED_COMMITS, 1)[0]
      : body) ?? ""
  );
}

/** The commit's `Changelog:` lines, in the order written. */
function readChangelogLines(commit: Commit) {
  return Array.from(
    readOwnBody(commit).matchAll(CHANGELOG_LINES),
    (match) => match[1]?.trim() ?? ""
  ).filter(Boolean);
}

/**
 * Whether a squash merge's list of commits holds one of `types` that is not
 * hidden by its own `Changelog:` line. A squash under a plain PR title, such
 * as "Cache shared radio metadata (#308)", is then listed by that title.
 */
function squashesListedType({ body }: Commit, types: string[]) {
  const listStart = body.search(SQUASHED_COMMITS);
  if (listStart === -1) {
    return false;
  }
  return body
    .slice(listStart)
    .split(SQUASHED_COMMITS)
    .some((squashed) => {
      const type = CONVENTIONAL_SUBJECT.exec(squashed.split("\n", 1)[0] ?? "");
      const line = CHANGELOG_LINE.exec(squashed)?.[1]?.trim().toLowerCase();
      return (
        types.includes(type?.[1] ?? "") && !(line && HIDDEN_VALUES.has(line))
      );
    });
}

/** The entry a commit's subject gives, when its type is listed. */
function readSubjectText(commit: Commit, types: string[]) {
  const conventional = CONVENTIONAL_SUBJECT.exec(commit.subject);
  if (conventional) {
    return types.includes(conventional[1] ?? "")
      ? conventional[2]?.replace(PULL_REQUEST_SUFFIX, "")
      : undefined;
  }
  return PULL_REQUEST_SUFFIX.test(commit.subject) &&
    squashesListedType(commit, types)
    ? commit.subject.replace(PULL_REQUEST_SUFFIX, "")
    : undefined;
}

/**
 * The entries a commit gives, in the order written: its `Changelog:` lines,
 * else its subject when listed, and none when a line hides it.
 */
function readEntryTexts(commit: Commit, types: string[]) {
  const lines = readChangelogLines(commit);
  if (lines.some((line) => HIDDEN_VALUES.has(line.toLowerCase()))) {
    return [];
  }
  if (lines.length > 0) {
    return lines;
  }
  const subjectText = readSubjectText(commit, types);
  return subjectText ? [subjectText] : [];
}

/**
 * Hashes of commits replaced by a newer `Changelog-Since:` note that is
 * itself listed. Resolve its boundary against unfiltered ancestry, since a
 * path-filtered log can omit that commit. `commits` is newest first.
 */
function findCoveredCommits(
  root: string,
  commits: Commit[],
  reverted: Set<string>,
  types: string[]
) {
  const covered = new Set<string>();
  for (const commit of commits) {
    if (
      reverted.has(commit.hash) ||
      covered.has(commit.hash) ||
      readEntryTexts(commit, types).length === 0
    ) {
      continue;
    }
    const since = CHANGELOG_SINCE.exec(readOwnBody(commit))?.[1]?.toLowerCase();
    if (!since) {
      continue;
    }
    try {
      const boundary = git(root, [
        "rev-parse",
        "--verify",
        `${since}^{commit}`,
      ]).trim();
      git(root, ["merge-base", "--is-ancestor", boundary, commit.hash]);
      for (const hash of git(root, [
        "rev-list",
        `${boundary}..${commit.hash}`,
      ]).split("\n")) {
        if (hash && hash !== commit.hash) {
          covered.add(hash);
        }
      }
    } catch {
      // An unresolved or unrelated boundary must not hide older entries.
    }
  }
  return covered;
}

/**
 * Newest first. `feat` commits are listed by their subject, and a squash
 * merge under a plain title that squashed one by that title. A `Changelog:`
 * line in a commit message rewords it (and lists any type), several list it
 * as several entries in the order written, and `Changelog: skip` hides it.
 * Reverted commits are dropped.
 *
 * A release note carries `Changelog-Since: <sha>`: its entries replace those
 * of its ancestors after the boundary commit, so those commits list nothing.
 * The boundary is resolved even when it changed none of the selected paths.
 * Work landed as squash merges or with its own commits on `main` is covered
 * either way; merge commits above the note list nothing.
 * Hidden notes and invalid, unresolved, or unrelated boundaries cover nothing.
 */
function parseGitChangelog(
  root: string,
  log: string,
  { types = ["feat"], limit = 12 }: GitChangelogOptions = {}
): ChangelogEntry[] {
  const commits: Commit[] = log
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", date = "", subject = "", body = ""] =
        record.split(FIELD_SEPARATOR);
      return { body, date, hash, subject };
    });
  const reverted = findRevertedCommits(commits);
  const covered = findCoveredCommits(root, commits, reverted, types);
  const entries: ChangelogEntry[] = [];
  const texts = new Set<string>();

  for (const commit of commits) {
    if (reverted.has(commit.hash) || covered.has(commit.hash)) {
      continue;
    }
    for (const [index, text] of readEntryTexts(commit, types).entries()) {
      if (entries.length >= limit) {
        return entries;
      }
      if (texts.has(text.toLowerCase())) {
        continue;
      }
      texts.add(text.toLowerCase());
      entries.push({
        date: commit.date,
        // Later lines get a suffix, so each entry's id is unique and stable.
        id: index === 0 ? commit.hash : `${commit.hash}:${index}`,
        text: capitalize(text),
      });
    }
  }
  return entries;
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

type GitChangelogSource = GitChangelogOptions & {
  /** Paths whose history counts, relative to the Vite root. */
  paths?: string[];
};

/** Reads entries from git, or none when there is no history to read. */
export function readGitChangelog(
  root: string,
  { paths = ["."], ...options }: GitChangelogSource = {}
): ChangelogEntry[] {
  let isShallow = false;
  try {
    isShallow =
      git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    // Not a repository: the log below reports it.
  }
  if (isShallow) {
    try {
      git(root, ["fetch", "--quiet", `--deepen=${DEEPEN_COUNT}`]);
    } catch {
      console.warn("[changelog] Shallow clone; older changes are missing");
    }
  }
  try {
    const log = git(root, [
      "log",
      `--max-count=${SCAN_COUNT}`,
      `--format=${GIT_LOG_FORMAT}`,
      "HEAD",
      "--",
      ...paths,
    ]);
    return parseGitChangelog(root, log, options);
  } catch {
    console.warn("[changelog] No git history; the changelog is empty");
    return [];
  }
}

/**
 * Serves `virtual:changelog` from the git history at build time, so merged
 * work shows up without anyone writing release notes. It also defines
 * `__CHANGELOG_NEWEST_DATE__`, the newest entry's date, which a first visit
 * marks as seen so the browser's clock never decides what is unread.
 */
export function gitChangelogPlugin(source: GitChangelogSource = {}): Plugin {
  let entries: ChangelogEntry[] = [];

  return {
    config(config) {
      entries = readGitChangelog(
        path.resolve(config.root ?? process.cwd()),
        source
      );
      return {
        define: {
          [NEWEST_DATE_GLOBAL]: JSON.stringify(entries[0]?.date ?? null),
        },
      };
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return;
      }
      return `export default ${JSON.stringify(entries)};`;
    },
    name: "git-changelog",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
    },
  };
}
