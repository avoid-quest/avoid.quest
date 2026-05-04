// Serial Planner with Review — three-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing ready issues with branch names.
//   Phase 2 (Execute + Review): For each selected issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). Selected issue pipelines
//                               run serially to avoid competing workspace edits.
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   bun run .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "bun run .sandcastle/main.ts" }

import { execFile as execFileWithCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { codex, createSandbox, run } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;
const MAX_ACTIVE_ISSUE_PIPELINES = 1;

type IssuePlan = { id: string; title: string; branch: string };
type IssueRunResult = { commits: { sha: string }[] };

const sharedNodeModulesPath = ".sandcastle/shared/node_modules";
const sharedBunCachePath = ".sandcastle/shared/bun-cache";
const execFile = promisify(execFileWithCallback);

await Promise.all([
  mkdir(sharedNodeModulesPath, { recursive: true }),
  mkdir(sharedBunCachePath, { recursive: true }),
]);

const git = (args: string[]) => execFile("git", args);

const formatIssue = (issue: IssuePlan) =>
  `${issue.id}: ${issue.title} → ${issue.branch}`;

const getCurrentBranch = async () => {
  const { stdout } = await git(["branch", "--show-current"]);
  return stdout.trim();
};

const ensureBranchExists = async (branch: string, baseBranch: string) => {
  try {
    await git(["rev-parse", "--verify", `refs/heads/${branch}`]);
  } catch {
    await git(["branch", branch, baseBranch]);
  }
};

const sandboxProvider = () =>
  docker({
    mounts: [
      {
        hostPath: sharedNodeModulesPath,
        sandboxPath: "node_modules",
      },
      {
        hostPath: sharedBunCachePath,
        sandboxPath: "/home/agent/.bun/install/cache",
      },
      {
        hostPath: "~/.codex",
        sandboxPath: "/home/agent/.codex",
      },
      {
        hostPath: "~/.convex",
        sandboxPath: "/home/agent/.convex",
      },
      {
        hostPath: "AGENTS.md",
        sandboxPath: "AGENTS.md",
        readonly: true,
      },
    ],
  });

// Hooks run inside the sandbox before the agent starts each iteration.
// bun install ensures the shared sandbox node_modules matches bun.lock.
// Install scripts are skipped because this repo has native runtime packages
// that do not have stable Linux arm64 prebuilds for the Sandcastle image.
const hooks = {
  sandbox: {
    onSandboxReady: [
      {
        command: "bun install --frozen-lockfile --ignore-scripts",
        timeoutMs: 300_000,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);
  const baseBranch = await getCurrentBranch();

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list
  // and builds a dependency graph so ready issues can be processed serially.
  //
  // It outputs a <plan> JSON block — we parse that to drive Phase 2.
  // -------------------------------------------------------------------------
  const plan = await run({
    hooks,
    sandbox: sandboxProvider(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code.
    maxIterations: 1,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: codex("gpt-5.5", { effort: "high" }),
    promptFile: "./.sandcastle/plan-prompt.md",
  });

  // Extract the <plan>…</plan> block from the agent's stdout.
  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  const planJson = planMatch?.at(1);
  if (!planJson) {
    throw new Error(
      `Planning agent did not produce a <plan> tag.\n\n${plan.stdout}`
    );
  }

  // The plan JSON contains an array of issues, each with id, title, branch.
  const { issues } = JSON.parse(planJson) as { issues: IssuePlan[] };

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  const selectedIssues = issues.slice(0, MAX_ACTIVE_ISSUE_PIPELINES);

  console.log(`Planning complete. ${issues.length} issue(s) available:`);
  console.log(
    `Configured max active issue pipelines: ${MAX_ACTIVE_ISSUE_PIPELINES}`
  );
  for (const issue of issues) {
    console.log(`  ${formatIssue(issue)}`);
  }

  if (selectedIssues.length < issues.length) {
    console.log(
      `Running only ${selectedIssues.length} issue pipeline(s) this iteration:`
    );
    for (const issue of selectedIssues) {
      console.log(`  ${formatIssue(issue)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  // -------------------------------------------------------------------------

  const settled: PromiseSettledResult<IssueRunResult>[] = [];

  for (const issue of selectedIssues) {
    try {
      const outcome = await (async (): Promise<IssueRunResult> => {
        await ensureBranchExists(issue.branch, baseBranch);

        const sandbox = await createSandbox({
          branch: issue.branch,
          baseBranch,
          sandbox: sandboxProvider(),
          hooks,
        });

        try {
          // Run the implementer
          const implement = await sandbox.run({
            name: "implementer",
            maxIterations: 100,
            agent: codex("gpt-5.5", { effort: "medium" }),
            promptFile: "./.sandcastle/implement-prompt.md",
            promptArgs: {
              TASK_ID: issue.id,
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });

          // Only review if the implementer produced commits
          if (implement.commits.length > 0) {
            const review = await sandbox.run({
              name: "reviewer",
              maxIterations: 1,
              agent: codex("gpt-5.5", { effort: "high" }),
              promptFile: "./.sandcastle/review-prompt.md",
            });

            // Merge commits from both runs so the merge phase sees all of them.
            // Each sandbox.run() only returns commits from its own run.
            return {
              ...review,
              commits: [...implement.commits, ...review.commits],
            };
          }

          return implement;
        } finally {
          await sandbox.close();
        }
      })();

      settled.push({ status: "fulfilled", value: outcome });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
    }
  }

  const completedIssues: IssuePlan[] = [];

  // Log any agents that threw (network error, sandbox crash, etc.) and keep
  // only branches that actually produced commits for the merge phase.
  for (const [i, outcome] of settled.entries()) {
    const issue = selectedIssues.at(i);
    if (!issue) {
      continue;
    }

    if (outcome.status === "rejected") {
      console.error(
        `  x ${issue.id} (${issue.branch}) failed: ${outcome.reason}`
      );
      continue;
    }

    if (outcome.value.commits.length > 0) {
      completedIssues.push(issue);
    }
  }

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    if (settled.some((outcome) => outcome.status === "rejected")) {
      throw new Error("All issue pipelines failed before producing commits.");
    }

    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await run({
    hooks,
    sandbox: sandboxProvider(),
    name: "merger",
    maxIterations: 1,
    agent: codex("gpt-5.4-mini"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
