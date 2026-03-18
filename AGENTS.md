<repo_scope>
Applies repo-wide. Optimize for GPT-5.4 coding-agent work in this repository.
Keep runtime prompts, app prompts, chat prompts, and product-behavior prompts unchanged unless the user explicitly asks.
</repo_scope>

<default_follow_through_policy>
- Inspect the affected workspace(s) first, then implement, validate, and report.
- Persist until the task is finished end-to-end within the current turn unless blocked by missing credentials, an unavailable external service, or an explicit user stop.
- Prefer making the change over describing the change. Do not stop at analysis when the repo can be updated directly.
</default_follow_through_policy>

<missing_context_gating>
- Do not guess app/package ownership, env vars, Cloudflare bindings, Convex deployment state, or secret values.
- If a risky detail cannot be inferred locally, ask a short focused question. Otherwise state the assumption and proceed.
- Do not invent behavior changes outside the requested scope.
</missing_context_gating>

<terminal_tool_hygiene>
- Work from the repo root. Use Bun workspace commands; prefer `bun run --filter <workspace> ...` for scoped work and repo scripts for cross-workspace tasks.
- Prefer `rg` and `rg --files` for search.
- Read generated files only for reference; edit the source of truth instead.
- Avoid long-running watchers (`bun run dev`, `convex dev`) unless they are required for regeneration or the user asked for them.
- Never run deploy/publish commands (`cf-deploy`, `cf-upload`, `deploy:backend`, `version-packages`) unless the user explicitly asks.
</terminal_tool_hygiene>

<repo_invariants>
- This is a Bun workspace + Turborepo monorepo. Preserve workspace boundaries and shared-package imports; prefer shared code in `packages/*` over cross-app duplication.
- Treat these as generated and do not hand-edit them:
  - `apps/*/src/routeTree.gen.ts`
  - `apps/*/cloudflare-env.d.ts`
  - `packages/backend/convex/_generated/**`
  - `packages/backend/convex/components/*/_generated/**`
- TanStack Start route trees are generated from file-based routes. Change route source files, then regenerate `routeTree.gen.ts` through the normal tooling instead of editing it manually.
- React Compiler is enabled in the Vite/TanStack React apps. Do not add `useMemo`, `useCallback`, or `memo` by reflex; only do it for an existing local pattern or a measured hot path.
- Convex uses shared schema plus component-owned domains. Keep shared tables/functions in the shared Convex layer and keep domain-specific tables/functions inside their owning component namespace.
- In Convex, keep timestamps in milliseconds UTC, keep validators explicit, and use `internal*` for non-public functions. Do not hand-edit Convex generated files.
- Security-sensitive server paths must fail closed. Preserve existing auth, session, rate-limit, origin/URL validation, secret checks, and admin gating behavior unless the task explicitly changes them.
</repo_invariants>

<validation_contract>
- Before claiming completion, run the narrowest command set that proves the change.
- Docs-only changes: verify paths/commands manually; no repo-wide build is required.
- Default for code changes from the repo root:
  - `bun run check`
  - `bun run typecheck`
- Then run touched-workspace validation when relevant:
  - frontend app change: `bun run --filter <workspace> build`
  - package or app with tests: `bun run --filter <workspace> test`
  - Convex/backend change with tests: run that workspace's test command
  - Cloudflare binding/type changes: `bun run --filter <workspace> cf-typegen`
  - Convex schema/API changes: regenerate Convex `_generated/**` with Convex tooling; if that cannot be done locally, say so explicitly
- If you skip validation, say exactly what was skipped and why.
</validation_contract>

<final_response_contract>
- Be concise.
- Include: what changed, validation run, anything not verified, and any remaining assumption or blocker.
- Reference files and commands precisely. Do not claim success without naming the checks that passed.
</final_response_contract>
