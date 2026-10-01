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
 * The commit's `Changelog:` line. In a squash merge (a subject ending in
 * `(#123)`), lines inside the list of squashed commits belong to those
 * commits, so only the lines above that list count.
 */
function readChangelogLine({ body, subject }: Commit) {
  const own = PULL_REQUEST_SUFFIX.test(subject)
    ? body.split(SQUASHED_COMMITS, 1)[0]
    : body;
  return CHANGELOG_LINE.exec(own ?? "")?.[1]?.trim();
}

/**
 * Newest first. `feat` commits are listed by their subject. A `Changelog:`
 * line in a commit message rewords it (and lists any type), and
 * `Changelog: skip` hides it. Reverted commits are dropped.
 */
function parseGitChangelog(
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
  const entries: ChangelogEntry[] = [];
  const texts = new Set<string>();

  for (const commit of commits) {
    if (entries.length >= limit) {
      break;
    }
    if (reverted.has(commit.hash)) {
      continue;
    }
    const override = readChangelogLine(commit);
    if (override && HIDDEN_VALUES.has(override.toLowerCase())) {
      continue;
    }
    const conventional = CONVENTIONAL_SUBJECT.exec(commit.subject);
    const subjectText =
      conventional && types.includes(conventional[1] ?? "")
        ? conventional[2]?.replace(PULL_REQUEST_SUFFIX, "")
        : undefined;
    const text = override || subjectText;
    if (!text || texts.has(text.toLowerCase())) {
      continue;
    }
    texts.add(text.toLowerCase());
    entries.push({
      date: commit.date,
      id: commit.hash,
      text: capitalize(text),
    });
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
    return parseGitChangelog(log, options);
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
