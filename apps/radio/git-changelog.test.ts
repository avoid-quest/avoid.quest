import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readGitChangelog } from "./git-changelog";

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

/** One day apart, so the order is the commit order. */
function nextCommitDate() {
  commitCount += 1;
  return {
    GIT_COMMITTER_DATE: `2026-09-${String(commitCount).padStart(2, "0")}T12:00:00Z`,
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

afterAll(() => {
  rmSync(repo, { force: true, recursive: true });
});

describe("readGitChangelog", () => {
  test("lists features and reworded commits for the app's paths, newest first", () => {
    const entries = readGitChangelog(repo, { paths: ["app"] });

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
    expect(readGitChangelog(repo, { limit: 1, paths: ["app"] })).toHaveLength(
      1
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
