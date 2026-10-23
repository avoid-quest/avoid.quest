# Cloudflare Worker Previews migration

Researched 2026-10-23 against current Cloudflare documentation, Wrangler's
installed schema/source, and both installed workerd binaries. Scope: research
only; no deployment, upload, dashboard change, commit, or PR creation.

## Recommendation

Use **Worker Previews**, launched September 22, 2026, for branch/PR testing.
The command is `wrangler preview`; `wrangler versions upload` creates the older
**Version URLs**, which use production resources. Worker Previews require
Wrangler **4.135.0+**; the workspace-installed **4.151.3** already supports them.
The command is currently labeled **open beta**. [Launch][launch],
[comparison][comparison], [getting started][start], [Wrangler changelog][wrangler]

The smallest recommended implementation is:

- Add `previews: {}` to `apps/web/wrangler.jsonc`. Keep `assets`, including the
  `ASSETS` binding, `compatibility_date`, and `compatibility_flags` at top level.
  Existing top-level observability applies unless overridden. [Configuration][config]
- Add `previews.ratelimits` to `apps/radio/wrangler.jsonc`, preserving binding
  name `proxy-rate-limit` and the existing policy (`limit: 100`, `period: 10`).
  An empty block would omit that binding: `src/lib/rate-limit.ts` deliberately
  fails closed outside development when it is missing. Rate-limit bindings
  are supported explicitly in the current schema and uploader. [Resources][resources],
  [uploader source][uploader]
- A minimal migration can preserve the known `namespace_id: "1"`, but must
  document that Preview and production counters then share a namespace. For
  isolation, choose a different account-unique integer confirmed unused by the
  maintainer; no account namespace inventory was inspected. This is a
  user-defined integer, not a provisioned namespace ID to fabricate or fetch.
  Previews using the same chosen ID still share counters with one another.
  [Resources][resources], [rate-limit configuration][ratelimit]
- **Keep `preview_urls: true` and `workers_dev: true`.** `preview_urls` remains
  the documented switch for `workers.dev` URLs in the new Preview workflow;
  changing it to `false` would disable that exposure. The new `previews` block
  configures branch settings; it does not replace this URL switch. Production
  `workers.dev` exposure is independently controlled by `workers_dev`.
  [Preview URL configuration][domains]
- Add a `cf-preview` script that builds the relevant app and then invokes its
  workspace-installed `wrangler preview`. Root orchestration can use
  `turbo cf-preview` with a noncached task, passing existing Cloudflare auth
  variables and `WORKERS_CI_BRANCH` through Turbo. Wrangler uses that variable
  for the Preview name before falling back to other CI metadata or Git.
  `cf-upload` may remain as an explicitly documented alias to `cf-preview` for
  existing preview callers; it should no longer upload production Worker
  versions as the PR-preview mechanism. Preserve `cf-deploy` for production.
  [Getting started][start], [Builds configuration][build-config],
  [branch-name resolution source][uploader]
- Update `DEVELOPMENT.md` and both app README preview sections to distinguish
  Worker Previews, local framework `preview` commands, and production deploys.
  Do not edit generated Wrangler/route files by hand. Regenerate radio bindings
  normally if the compatibility-date change alters generated types.

These recommendations use the original checked-in configs as the baseline:
web date `2026-02-06`, radio date `2026-08-26`, both URL flags enabled, and
`cf-upload` invoking `wrangler versions upload`. Other implementation work was
occurring concurrently in this shared checkout; this research owns only this note.

## Latest compatibility date without dependency changes

**Use `2026-10-19` for both apps.** This is the newest common date supported by
all relevant installed runtimes, not merely a date inferred from a package name.

- Direct app Wrangler **4.151.3** resolves workerd **1.20261019.1**. Its release
  date is October 19, but its compiled maximum is **October 26**. Therefore it
  accepts today's date, **2026-10-23**. [Release maximum][maximum-new]
- Radio's installed `@cloudflare/vite-plugin` **1.64.0** resolves its own Wrangler
  **4.151.0** and Miniflare **5.20261012.0-beta**, using workerd
  **1.20261012.1**. That binary's compiled maximum is **2026-10-19**.
  This dependency graph was resolved from the package's real filesystem path,
  avoiding the misleading root-level Wrangler resolution. [Older maximum][maximum-old]
- Both workerd binaries were exercised locally with a temporary Cap'n Proto
  Worker config and a trivial exported test using `workerd test -I / <config>`.
  Both passed at **2026-10-19**. The older binary rejected **2026-10-20** and
  **2026-10-23** with: `the newest date supported by this server binary is
  "2026-10-19"`. The newer binary passed at **2026-10-23**. No server watcher or
  remote operation was used.

Cloudflare deliberately builds workerd with a maximum seven days beyond its
release date, and separately rejects future dates. Thus neither “use today's
date everywhere” nor “use the workerd release date” is a reliable universal
rule for this installed dependency graph. To use October 23 in both apps,
first update the framework dependency that owns the older runtime and validate
again. The exported npm `compatibilityDate` is the release date, not the
compiled upper bound. [Build definition][runtime-build], [validation source][runtime-validation]

Keep the explicit `nodejs_compat` flags and web's
`global_fetch_strictly_public` flag. A date bump opts into runtime behavior
changes and needs app validation. Since radio's previous date, defaults include
spec-compliant event-listener exception handling (September 15) and Durable
Object I/O eviction behavior (October 1); web crosses additional stream,
encoding, error, and Node compatibility changes. Runtime support does not prove
the app is unaffected. [Compatibility dates][dates], [compatibility flags][flags]

## Dashboard requirements for each existing Worker

Repository changes do **not** perform the existing Workers Builds migration.
For each Worker (`avoid-quest` and `radio`), a maintainer must later:

1. Open **Workers & Pages → Worker → Settings → Builds** and select **Set up**
   in the **Set up Worker Previews** banner. Configure Preview variables,
   secrets, and bindings; review the command; select **Switch to Worker Previews**.
   Cloudflare explicitly says **this switch cannot be reversed**. New Workers
   use Previews by default; previously connected Workers keep the old model
   until switched. [Existing-worker setup][build-branches]
2. Confirm **Enable Preview Builds** under **Branch control**, the intended
   production branch, and the Preview/nonproduction command. The switch replaces
   the old command with `npx wrangler preview`; a custom command must ultimately
   invoke `wrangler preview`. If Builds runs at repo root, use the appropriate
   scoped script, for example `bun run --filter @avoid.quest/web cf-preview` or
   `bun run --filter @avoid.quest/radio cf-preview`. If its root is the app
   directory, use `bun run cf-preview`. Verify the actual root/build command to
   avoid rebuilding twice or uploading stale output; no remote settings were
   inspected. [Build branches][build-branches], [Build settings][build-config]
3. Confirm **Domains → Worker URL → Preview** is enabled remotely. Committed
   `preview_urls: true` does not establish that it was already applied. Applying
   a URL setting through `wrangler deploy` deploys the checkout's code too, so
   that command must not be run as a configuration-only step in this task.
   Existing `workers.dev` routing requires no new hostname. Custom Preview
   domains are optional and remain dashboard/account-managed here. [Domains][domains]
4. Configure any required Preview runtime secrets separately. They are not
   inherited from production. Base secrets are copied into **new** Previews;
   later Base edits do not update existing ones. Supported commands include
   `wrangler preview base-config secret put SECRET_NAME` and
   `wrangler preview secret put SECRET_NAME --name <preview>`; these are future
   authorized setup operations, not commands run for this research. Radio can
   render without optional feedback/Sentry credentials; do not copy production
   credentials merely to make a Preview. Build-only variables are distinct from
   runtime secrets. [Preview secrets][config], [Build settings][build-config]

With the GitHub/GitLab integration and Preview Builds configured, Builds posts
the Preview URL on the PR. Subsequent pushes update the stable branch Preview
URL; each deployment also has an immutable URL. Do not add a second deployment
pipeline just to create those comments. [Builds examples][examples],
[GitHub integration][github]

## Security and limitations

- Preview URLs are public by default. `workers.dev` Previews receive
  `X-Robots-Tag: noindex`; that is not authentication. Cloudflare Access can
  protect a Worker's Previews, all account Previews, or selected hostnames.
  Custom domains need their own noindex/Access policy. [Overview][overview], [domains][domains]
- Branch configuration does not automatically create separate KV/D1/R2 or
  other account resources. Identical IDs mean shared resources. Durable Objects
  and Containers receive automatic per-Preview isolation; neither is declared
  by these apps. Service bindings call the destination Worker's production
  deployment; Workflows bind existing deployed Workflows; Queue consumers,
  Cron Triggers, and production zone routes do not target Previews.
  [Resources and limitations][resources]
- Preview resources have retention limits: 100 Previews per Worker on Free,
  500 on Paid; 100 deployments per Preview. Old entries are removed automatically
  when limits are reached. `wrangler preview delete --name <preview>` is the
  explicit cleanup command. [Overview][overview]
- Preserve the apps' current auth, origin/URL checks, secret checks, rate limits,
  hostname-based monitoring, and analytics behavior. A Preview URL alone does
  not verify these server paths or production-domain integrations.

## Verification and remaining unknowns

Read `AGENTS.md`, the deployment section of `DEVELOPMENT.md`, both app
Wrangler/package files, and both README preview sections. Checked the installed
`config-schema.json` (`PreviewsConfig`, including `ratelimits`), uploader source,
dependency resolution, `wrangler preview --help`, official docs/changelog, and
the runtime date probes above. Only this Markdown note was authored.

No app checks/builds/type generation were run for this documentation-only
research; the implementing agent should run the repository's required validation.
No deployment, upload, remote account query/change, credential inspection, or PR
creation occurred. Actual Builds roots/commands, one-time switch status, domain
settings, account-level resources, and Preview secrets remain unverified.

[launch]: https://developers.cloudflare.com/changelog/2026-09-22-worker-previews/
[overview]: https://developers.cloudflare.com/workers/previews/
[start]: https://developers.cloudflare.com/workers/previews/get-started/
[comparison]: https://developers.cloudflare.com/workers/previews/compare-workflows/
[config]: https://developers.cloudflare.com/workers/previews/configuration/
[resources]: https://developers.cloudflare.com/workers/previews/resources/
[domains]: https://developers.cloudflare.com/workers/previews/custom-domains/
[examples]: https://developers.cloudflare.com/workers/previews/examples/
[build-config]: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#preview-command
[build-branches]: https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/#existing-workers-connected-to-builds
[github]: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/#pull-request-comment
[ratelimit]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
[dates]: https://developers.cloudflare.com/workers/configuration/compatibility-dates/
[flags]: https://developers.cloudflare.com/workers/configuration/compatibility-flags/
[wrangler]: https://github.com/cloudflare/workers-sdk/blob/wrangler%404.151.3/packages/wrangler/CHANGELOG.md
[uploader]: https://github.com/cloudflare/workers-sdk/blob/wrangler%404.151.3/packages/deploy-helpers/src/preview/shared.ts
[maximum-new]: https://github.com/cloudflare/workerd/blob/v1.20261019.1/src/workerd/io/maximum-compatibility-date.txt
[maximum-old]: https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/io/maximum-compatibility-date.txt
[runtime-build]: https://github.com/cloudflare/workerd/blob/v1.20261019.1/src/workerd/io/BUILD.bazel
[runtime-validation]: https://github.com/cloudflare/workerd/blob/v1.20261019.1/src/workerd/io/compatibility-date.c%2B%2B
