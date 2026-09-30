import { execFileSync } from "node:child_process";
import type { ChangelogEntry } from "@avoid.quest/ui/lib/changelog";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:changelog";
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
const HIDDEN_VALUES = new Set(["-", "no", "none", "skip"]);

export type GitChangelogOptions = {
  /** Conventional commit types listed without a `Changelog:` line. */
  types?: string[];
  limit?: number;
};

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  const commits = log
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", date = "", subject = "", body = ""] =
        record.split(FIELD_SEPARATOR);
      return { body, date, hash, subject };
    });
  const reverted = new Set(
    commits.flatMap(({ body }) =>
      Array.from(body.matchAll(REVERTED_COMMIT), (match) => match[1])
    )
  );
  const entries: ChangelogEntry[] = [];
  const texts = new Set<string>();

  for (const commit of commits) {
    if (entries.length >= limit) {
      break;
    }
    if (reverted.has(commit.hash)) {
      continue;
    }
    const override = CHANGELOG_LINE.exec(commit.body)?.[1]?.trim();
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
 * work shows up without anyone writing release notes.
 */
export function gitChangelogPlugin(source: GitChangelogSource = {}): Plugin {
  let root = process.cwd();
  let entries: ChangelogEntry[] | undefined;

  return {
    configResolved(config) {
      ({ root } = config);
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return;
      }
      entries ??= readGitChangelog(root, source);
      return `export default ${JSON.stringify(entries)};`;
    },
    name: "git-changelog",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
    },
  };
}
