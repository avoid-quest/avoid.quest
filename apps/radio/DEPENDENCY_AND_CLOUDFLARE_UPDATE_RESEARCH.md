# Dependency and Cloudflare update research

Checked against current official documentation on 2026-08-26. This note covers
the repository-wide dependency update and the radio Worker's deploy path. It
does not cover account-side routes, custom domains, or secret values because
those cannot be inferred from the checkout.

## Dependency update

The repository is a Bun workspace with a single text lockfile and a root
catalog. That is the right model. Bun installs every workspace from the root,
and catalog entries let all packages share one version declaration
([Bun workspaces](https://bun.sh/docs/pm/workspaces),
[Bun catalogs](https://bun.sh/docs/pm/catalogs)). Keep shared versions in the
catalog instead of adding another direct version to an app.

Use this update flow:

1. Run `bun outdated -r`. Bun reports workspace and catalog entries in the
   recursive view
   ([`bun outdated`](https://bun.sh/docs/pm/cli/outdated)).
2. Run `bun update --latest --recursive`, or use `bun update -i -r` to select
   updates. Normal `bun update` stays within declared ranges, while `--latest`
   can cross major versions
   ([`bun update`](https://bun.sh/docs/pm/cli/update)).
3. Review all changed manifests and `bun.lock`. Commit the lockfile. Bun uses
   `bun.lock` for reproducible installs, and `bun ci` is equivalent to
   `bun install --frozen-lockfile`
   ([Bun lockfile](https://bun.sh/docs/pm/lockfile),
   [`bun install`](https://bun.sh/docs/pm/cli/install)).
4. Run the repository checks, then each affected app's build and tests. Treat
   TypeScript 7, Astro 7 and its Cloudflare adapter, TanStack DB, and the
   openDAW packages as migration groups rather than assuming that a successful
   install proves compatibility. These are the current major or pre-1.0 jumps
   reported by the local `bun outdated -r` audit.

The checkout pins Bun 1.3.14 in the root
[`packageManager`](../../package.json) and the Discord bot
[`Dockerfile`](../discord-bot/Dockerfile). Bun 1.4.0 is the current stable
release on the captured date, and the official upgrade command is
`bun upgrade` ([Bun installation and upgrading](https://bun.sh/docs/installation)).
If the project adopts Bun 1.4, update both pins together.

The root already uses Turborepo 2, so the 1-to-2 codemod is not needed. Update
the root `turbo` dependency and the Dockerfile's global Turbo pin together so
`turbo prune` and local task execution use the same release. Turborepo accepts
the existing top-level `packageManager` declaration for backwards
compatibility, although its current upgrade guide prefers
`devEngines.packageManager`
([Turborepo upgrading](https://turborepo.com/docs/crafting-your-repository/upgrading)).
The current [`turbo.json`](../../turbo.json) already declares dependency build
ordering and `dist/**` output caching in the documented form. Change its schema
URL to the current canonical `https://turborepo.dev/schema.json`; the old
`turbo.build` URL currently redirects there
([Turborepo configuration](https://turborepo.dev/docs/reference/configuration),
[configuring Turborepo tasks](https://turborepo.com/docs/crafting-your-repository/configuring-tasks)).

There is one build correctness issue independent of package versions.
[`vite.config.ts`](vite.config.ts) reads `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, and `SENTRY_RELEASE`, but the root Turbo `build` task does not
declare them. Turbo's default strict environment mode filters undeclared
variables. Vite framework inference accounts for `VITE_*`, not these
`SENTRY_*` names. Add them to the radio build task's `env` so their values also
participate in the build hash
([Turborepo environment variables](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables)).
If CI runs deploy or upload through Turbo, put `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in those tasks' `passThroughEnv`. They authenticate
Wrangler but do not change build output
([Wrangler system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/),
[Turbo `passThroughEnv`](https://turborepo.dev/docs/reference/configuration#passthroughenv)).

## Radio Worker findings

Several important parts are already correct:

- [`wrangler.jsonc`](wrangler.jsonc) uses the JSONC format that Cloudflare
  recommends and treats as the Worker configuration source of truth
  ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- `main: "@tanstack/react-start/server-entry"` matches TanStack Start's
  Cloudflare entry point. [`vite.config.ts`](vite.config.ts) also places
  `cloudflare({ viteEnvironment: { name: "ssr" } })` before `tanstackStart()`
  and the React plugin, matching the official setup
  ([TanStack Start hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting),
  [Cloudflare Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/vite-environments/)).
- Do not add `assets.directory` to the input config. The Cloudflare Vite plugin
  detects the client build and writes the client output path into its generated
  deploy configuration
  ([Vite plugin static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)).
- The rate-limit binding shape is valid. Its period is one of the allowed
  values, and its namespace is a positive integer written as a string
  ([Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
- `workers_dev: true` and `preview_urls: true` deliberately expose public
  Workers preview URLs. `wrangler versions upload` creates a version without
  promoting it and returns a version preview URL
  ([versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
  [preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)).

The update should make these changes:

1. Set `compatibility_date` to `2026-08-26` and test the built Worker. Cloudflare
   recommends setting new Workers to the current date and updating existing
   dates periodically after reviewing the intervening flags
   ([compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)).
2. Remove both current compatibility flags after that date bump. Node.js
   compatibility is enabled by default for dates on or after 2026-08-04, and
   current tools ignore the now-redundant positive flags
   ([Cloudflare's Node.js compatibility change](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)).
   `enable_nodejs_http_modules` was already redundant with `nodejs_compat` for
   the existing 2026-02-06 date because it became automatic on 2025-08-15
   ([Node.js HTTP in Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)).
3. Make both deployment scripts build first. The Cloudflare Vite plugin creates
   an output `wrangler.json` and a redirected deploy configuration during
   `vite build`; that output, not the source entry point alone, contains the
   Worker bundle and client asset directory. The current `cf-deploy` and
   `cf-upload` scripts can otherwise reuse stale output or omit the client
   build. Use `bun run build && wrangler deploy` and
   `bun run build && wrangler versions upload`, or make the CI pipeline pass a
   freshly built artifact to both commands
   ([Cloudflare Vite tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/),
   [generated Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#generated-wrangler-configuration)).
   Do not add a Wrangler `build.command`; Cloudflare marks custom Wrangler
   builds as inapplicable to the Vite plugin
   ([Wrangler custom builds](https://developers.cloudflare.com/workers/wrangler/configuration/#custom-builds)).
   Also add a radio `cf-build` script so the repository's root `cf-build`
   command includes this app. If Turbo restores a cached radio build, cache
   `.wrangler/deploy/**` along with `dist/**`; Wrangler needs that redirect to
   find the generated deployment config. A `^build` dependency means builds in
   dependency packages, while bare `build` means the same package
   ([Turborepo `dependsOn`](https://turborepo.dev/docs/reference/configuration#dependson)).
4. Regenerate `cloudflare-env.d.ts` after changing Wrangler, the compatibility
   date, flags, or bindings. `wrangler types` derives binding and runtime types
   from that configuration, and `wrangler types --check` can enforce freshness
   without rewriting the file
   ([Wrangler `types`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#types)).
   The existing check passes with the currently installed radio Wrangler. Once
   the generated declaration remains the source of runtime types, the radio
   package's direct `@cloudflare/workers-types` dependency is unnecessary for
   Wrangler 4 and has no import in the radio source
   ([Cloudflare TypeScript guidance](https://developers.cloudflare.com/workers/languages/typescript/)).

Two account or traffic decisions remain outside the repository:

- `namespace_id: "1"` is valid only if that positive integer is intentionally
  reserved for this limiter in the target Cloudflare account. Bindings that
  reuse a namespace share counters, even across Workers. Confirm the account
  mapping before deployment
  ([rate-limit namespace semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#configuration)).
- The current limiter keys anonymous callers by Cloudflare IP. Cloudflare warns
  that shared IPs can throttle unrelated users, but this endpoint has no
  trusted user or API key to substitute. Keep the fail-closed protection unless
  the product adopts a stronger trusted identity, and record the false-positive
  tradeoff
  ([rate-limit key guidance](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#best-practices)).

The current observability block enables persisted Worker logs. With no explicit
sampling rate it captures 100 percent by default. Keep that for low traffic, or
set a measured `head_sampling_rate` if log volume becomes material
([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)).
Do not guess a rate from the repository.

## Validation after implementation

From the repository root:

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run --filter @avoid.quest/radio test
bun run --filter @avoid.quest/radio build
bun run --filter @avoid.quest/radio cf-typegen
(cd apps/radio && bunx wrangler types --env-interface CloudflareEnv ./cloudflare-env.d.ts --check)
(cd apps/radio && bunx wrangler deploy --dry-run)
```

`wrangler deploy --dry-run` compiles the deployment without publishing it
([Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)).
Run a real deploy or version upload only when explicitly requested and when
Cloudflare credentials and the rate-limit namespace have been verified.
