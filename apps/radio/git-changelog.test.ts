import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitChangelogPlugin, readGitChangelog } from "./git-changelog";

/** Runs the enclosing `describe` against a fresh repository built by `setup`. */
function useRepo(setup: () => void) {
  let repo = "";
  let commitCount = 0;

  function git(args: string[], env?: Record<string, string>) {
    return execFileSync(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        ...args,
      ],
      {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, ...env },
      }
    ).trim();
  }

  /** One day apart from September 1st, so the order is the commit order. */
  function nextCommitDate() {
    commitCount += 1;
    return {
      GIT_COMMITTER_DATE: new Date(
        Date.UTC(2026, 8, commitCount, 12)
      ).toISOString(),
    };
  }

  /** Commits a change under `dir` and returns the commit hash. */
  function commit(message: string, dir = "app") {
    mkdirSync(path.join(repo, dir), { recursive: true });
    writeFileSync(path.join(repo, dir, "file.txt"), message);
    git(["add", "-A"]);
    git(["commit", "--quiet", "-m", message], nextCommitDate());
    return git(["rev-parse", "HEAD"]);
  }

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "git-changelog-"));
    git(["init", "--quiet"]);
    setup();
  });

  afterAll(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  return {
    commit,
    git,
    nextCommitDate,
    readTexts: () => readGitChangelog(repo).map(({ text }) => text),
    root: () => repo,
  };
}

describe("readGitChangelog", () => {
  const { commit, git, nextCommitDate, root } = useRepo(() => {
    commit("chore: scaffold");
    commit("feat(radio): preview metadata before playback (#311)");
    commit("fix(radio): reduce metadata polling");
    commit(
      "fix(radio): restore stations\n\nChangelog: Stations come back after a reset"
    );
    commit("feat(radio): add node-graph compiler\n\nChangelog: skip");
    const reverted = commit("feat(radio): add crossfade curves");
    git(["revert", "--no-edit", reverted], nextCommitDate());
    commit("feat(web): new landing page", "web");
    const restored = commit("feat(radio): add sleep timer");
    git(["revert", "--no-edit", restored], nextCommitDate());
    git(["revert", "--no-edit", "HEAD"], nextCommitDate());
    commit(
      "feat(radio): add station search (#340)\n\n* feat(radio): add search index\n\nChangelog: skip\n\n* feat(radio): add station search"
    );
    commit(
      "feat(radio): refactor the player (#341)\n\nChangelog: skip\n\n* feat(radio): split the player\n\nChangelog: A faster player"
    );
    commit("feat(ui)!: add HKCR preset");
  });

  test("lists features and reworded commits for the app's paths, newest first", () => {
    const entries = readGitChangelog(root(), { paths: ["app"] });

    expect(entries.map(({ text }) => text)).toEqual([
      "Add HKCR preset",
      "Add station search",
      "Add sleep timer",
      "Stations come back after a reset",
      "Preview metadata before playback",
    ]);
    expect(entries[0]?.id).toBe(git(["rev-parse", "HEAD"]));
    // Git spells UTC as `Z` or `+00:00`, depending on its version.
    expect(Date.parse(entries[0]?.date ?? "")).toBe(
      Date.parse("2026-09-14T12:00:00Z")
    );
  });

  test("stops at the limit", () => {
    expect(readGitChangelog(root(), { limit: 1, paths: ["app"] })).toHaveLength(
      1
    );
  });

  test("the plugin defines the newest entry's date for first visits", () => {
    const plugin = gitChangelogPlugin({ paths: ["app"] });
    const config = (
      plugin.config as (config: { root: string }) => {
        define: Record<string, string>;
      }
    )({ root: root() });
    const newest = readGitChangelog(root(), { paths: ["app"] })[0]?.date;

    expect(config.define.__CHANGELOG_NEWEST_DATE__).toBe(
      JSON.stringify(newest)
    );
  });

  test("returns nothing outside a repository", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "git-changelog-empty-"));
    try {
      expect(readGitChangelog(empty)).toEqual([]);
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });
});

describe("squash merges under a plain title", () => {
  const { commit, readTexts } = useRepo(() => {
    commit(
      "Cache shared radio metadata in Workers KV (#308)\n\n* feat(radio): share public radio metadata\n\n* fix(radio): close shared metadata cache gaps"
    );
    commit(
      "Update dependencies and configure worker setup (#300)\n\n* Update dependencies\n\n* chore: defer client-only modules"
    );
    commit(
      "Reorganize the player internals (#299)\n\n* feat(radio): split the player store\n\nChangelog: skip"
    );
  });

  test("lists one that squashed a feature by its title", () => {
    expect(readTexts()).toEqual(["Cache shared radio metadata in Workers KV"]);
  });
});

describe("several Changelog lines in one commit", () => {
  let hash = "";

  const { commit, root } = useRepo(() => {
    commit("feat(radio): add an old feature");
    commit(
      "fix(radio): tidy the settings (#360)\n\nChangelog: tidier settings\n\n* fix(radio): tidy settings\n\nChangelog: Not this one"
    );
    hash = commit(
      "feat(radio): ship the release\n\nChangelog: first change\nChangelog: Tidier settings\nChangelog: Third change\nChangelog-Since: not a hash"
    );
    commit("feat(radio): hidden\n\nChangelog: Shown?\nChangelog: skip");
  });

  test("lists each in the order written, deduped, and never the Since line", () => {
    const entries = readGitChangelog(root());

    expect(entries.map(({ text }) => text)).toEqual([
      "First change",
      "Tidier settings",
      "Third change",
      "Add an old feature",
    ]);
    expect(entries.slice(0, 3).map(({ id }) => id)).toEqual([
      hash,
      `${hash}:1`,
      `${hash}:2`,
    ]);
  });

  test("stops at the limit within a commit", () => {
    expect(
      readGitChangelog(root(), { limit: 2 }).map(({ text }) => text)
    ).toEqual(["First change", "Tidier settings"]);
  });
});

const RELEASE_NOTE =
  "Changelog: Mix stations in Node mode.\nChangelog: Play Mixcloud shows.\nChangelog-Since: ";

describe("a release note landed by squash merges", () => {
  const { commit, readTexts } = useRepo(() => {
    commit("feat(radio): preview metadata before playback (#311)");
    const since = commit("feat(radio): add the base feature (#328)");
    commit("feat(radio): add node mode (#330)");
    commit("fix(radio): fix knobs (#331)\n\nChangelog: Knobs reset");
    commit("Polish the player (#332)\n\n* feat(radio): polish the player");
    commit(
      `feat(radio): summarize the Node release (#333)\n\n${RELEASE_NOTE}${since.slice(0, 8)}\n\nCo-Authored-By: Test <test@example.com>`
    );
    commit("feat(radio): add a later feature (#334)");
    commit("feat(radio): add a hidden feature (#335)\n\nChangelog: skip");
  });

  test("replaces the covered commits and keeps the rest", () => {
    expect(readTexts()).toEqual([
      "Add a later feature",
      "Mix stations in Node mode.",
      "Play Mixcloud shows.",
      "Add the base feature",
      "Preview metadata before playback",
    ]);
  });
});

describe("a release note landed with its commits by a merge commit", () => {
  const { commit, git, nextCommitDate, root } = useRepo(() => {
    commit("feat(radio): preview metadata before playback");
    const since = commit("feat(radio): add the base feature");
    git(["switch", "--quiet", "-c", "stack"]);
    commit("feat(radio): add node mode");
    commit("fix(radio): fix knobs\n\nChangelog: Knobs reset");
    commit(
      `feat(radio): summarize the Node release\n\n${RELEASE_NOTE}${since}`
    );
    git(["switch", "--quiet", "-"]);
    commit("feat(radio): add a feature on main", "web");
    git(
      [
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        "Merge pull request #333 from avoid-quest/stack\n\nfeat(radio): summarize the Node release",
        "stack",
      ],
      nextCommitDate()
    );
    commit("feat(radio): add a later feature");
  });

  test("replaces the covered commits and keeps the rest", () => {
    expect(
      readGitChangelog(root(), { paths: ["app"] }).map(({ text }) => text)
    ).toEqual([
      "Add a later feature",
      "Mix stations in Node mode.",
      "Play Mixcloud shows.",
      "Add the base feature",
      "Preview metadata before playback",
    ]);
  });
});

describe("a release note whose Since matches no commit", () => {
  const { commit, readTexts } = useRepo(() => {
    commit("feat(radio): add an old feature");
    commit(`feat(radio): summarize the release\n\n${RELEASE_NOTE}deadbeef`);
    commit("feat(radio): add a later feature");
  });

  test("keeps older entries when the boundary cannot be resolved", () => {
    expect(readTexts()).toEqual([
      "Add a later feature",
      "Mix stations in Node mode.",
      "Play Mixcloud shows.",
      "Add an old feature",
    ]);
  });
});

describe("a release note whose boundary changed only another app", () => {
  const { commit, root } = useRepo(() => {
    commit("feat(radio): add an old feature");
    const since = commit("feat(web): update the homepage", "web");
    commit("feat(radio): add node mode");
    commit(`feat(radio): summarize the release\n\n${RELEASE_NOTE}${since}`);
  });

  test("covers newer app changes and keeps entries before the boundary", () => {
    expect(
      readGitChangelog(root(), { paths: ["app"] }).map(({ text }) => text)
    ).toEqual([
      "Mix stations in Node mode.",
      "Play Mixcloud shows.",
      "Add an old feature",
    ]);
  });
});

describe("hidden and unlisted release notes", () => {
  const { commit, readTexts } = useRepo(() => {
    const since = commit("chore: scaffold");
    commit("feat(radio): add an old feature");
    commit(
      `feat(radio): hidden release\n\nChangelog: skip\nChangelog-Since: ${since}`
    );
    commit(`chore: unlisted release\n\nChangelog-Since: ${since}`);
  });

  test("never hide older entries", () => {
    expect(readTexts()).toEqual(["Add an old feature"]);
  });
});

describe("a release note whose boundary is not its ancestor", () => {
  const { commit, git, readTexts } = useRepo(() => {
    commit("feat(radio): add an old feature");
    git(["switch", "--quiet", "-c", "other"]);
    const since = commit("feat(web): update the homepage", "web");
    git(["switch", "--quiet", "-"]);
    commit(`feat(radio): summarize the release\n\n${RELEASE_NOTE}${since}`);
  });

  test("keeps older entries", () => {
    expect(readTexts()).toEqual([
      "Mix stations in Node mode.",
      "Play Mixcloud shows.",
      "Add an old feature",
    ]);
  });
});

describe("a reverted release note", () => {
  const { commit, git, nextCommitDate, readTexts } = useRepo(() => {
    const since = commit("chore: scaffold");
    commit("feat(radio): add node mode");
    const note = commit(
      `feat(radio): summarize the release\n\n${RELEASE_NOTE}${since}`
    );
    git(["revert", "--no-edit", note], nextCommitDate());
  });

  test("restores the entries that the note covered", () => {
    expect(readTexts()).toEqual(["Add node mode"]);
  });
});
