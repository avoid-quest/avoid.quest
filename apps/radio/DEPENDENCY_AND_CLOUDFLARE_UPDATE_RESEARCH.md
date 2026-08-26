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

After the compatible updates, `bun outdated -r` reports only TypeScript 7.0.2.
Keep TypeScript 6.0.3 for this update: TypeScript 7 intentionally ships without
the compiler API until 7.1, and the TypeScript team documents a side-by-side
TypeScript 6 compatibility package for tools that still import that API. Moving
this workspace to 7 is therefore a toolchain migration, not a safe dependency
bump ([TypeScript 7.0 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).

The root [`packageManager`](../../package.json) and the Discord bot
[`Dockerfile`](../discord-bot/Dockerfile) now pin Bun 1.4.0 together. Bun 1.4.0
is the current stable release on the captured date, and the official upgrade
command is `bun upgrade`
([Bun installation and upgrading](https://bun.sh/docs/installation)).

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

### TanStack DB and Worker startup

Keep the current stable `@tanstack/react-db@0.3.5` and its exact
`@tanstack/db@0.8.5` dependency. TanStack DB commit
[`d8defd2`](https://github.com/TanStack/db/commit/d8defd2a8eb96162cbd4e24970d519eac217bb95)
introduced a runtime-reference singleton whose released source generates a
random namespace while the module is evaluated
([React DB 0.3.5 metadata](https://registry.npmjs.org/%40tanstack%2Freact-db/0.3.5),
[DB 0.8.5 source](https://github.com/TanStack/db/blob/5695db966ca6b4476b10aade33795cae57e68826/packages/db/src/query/runtime-reference-identity.ts#L7-L34)).
Cloudflare supports `crypto.getRandomValues()`, but forbids generating random
values in Worker global scope; a top-level startup failure produces validation
error 10021
([Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
[global-scope restriction](https://developers.cloudflare.com/hyperdrive/observability/troubleshooting/#workers-runtime-errors),
[validation error 10021](https://developers.cloudflare.com/workers/observability/errors/#validation-errors-10021)).

The radio app uses React DB for `localStorage` and `sessionStorage` collections
under routes with `ssr: false`, so it should not be evaluated while the Worker
entry starts. TanStack documents browser storage as client-only, supports
`.client.*` files and the `@tanstack/react-start/client-only` marker, and notes
that the HTML shell remains server-rendered even when the root route disables
SSR
([execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model),
[import protection](https://tanstack.com/start/latest/docs/framework/react/guide/import-protection),
[selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)).
Those framework boundaries are appropriate when the collection import graph is
refactored to be wholly client-only. Wrapping collection initialization or
moving it into a request handler is not sufficient while a static package
import still evaluates the singleton.

The immediate failure came from the app's custom `manualChunks` rule grouping
all TanStack packages together. That made the eagerly imported Start runtime
pull React DB into the Worker startup graph even though the DB consumers were
otherwise lazy. Rollup explicitly warns that manual chunks can change behavior
by triggering side effects before a module is used
([`output.manualChunks`](https://rollupjs.org/configuration-options/#output-manualchunks));
Vite exposes the underlying output options through its build configuration
([Vite build options](https://vite.dev/config/build-options.html#build-rollupoptions)).
Match `@tanstack/db` and `@tanstack/react-db` in a dedicated chunk before the
generic TanStack group. The generated Worker entry must not statically import
that DB chunk, and the server-rendered root shell must not load it while
handling a request. It may remain in client-only lazy modules, but evaluating
the released singleton anywhere in the Worker runtime still violates
Cloudflare's global-scope entropy restriction. The local Wrangler request test
is therefore required in addition to inspecting the entry chunk.

An upstream correction exists in commit
[`01e9cb5`](https://github.com/TanStack/db/commit/01e9cb5817619d8dadc801d6e105f1c5d0d1f88a),
which defers namespace generation until an identity is requested and tests
that constructing the factory consumes no entropy. It is still on open
[PR #1774](https://github.com/TanStack/db/pull/1774), outside `main`, with no
fixed npm release or prerelease on the captured date. TanStack's
[`049e0ce` CI preview](https://pkg.pr.new/TanStack/db/@tanstack/react-db@049e0ce)
is suitable for testing the upstream fix, not as the stable production source.

No Cloudflare switch is a substitute for this boundary. `nodejs_compat` is
already automatic for compatibility dates on or after 2026-08-04 and does not
relax the global entropy rule; `allow_eval_during_startup` only covers `eval`
and `new Function`; and Wrangler's `unsafe` configuration exposes unsupported
upload bindings and metadata, not a runtime-operation allowlist
([Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
[compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/),
[Wrangler `unsafe` schema](https://github.com/cloudflare/workers-sdk/blob/5377aaed47144ef5dc873d77a4e3aba0d0232f7c/packages/workers-utils/src/config/environment.ts#L1481-L1510)).
Vite aliases or transforms could rewrite the package, and Bun supports durable
dependency patches, but both approaches would maintain a private fork of
upstream behavior. Do not use them for this project; the application boundary
keeps the latest stable packages without patching dependencies
([Vite aliases](https://vite.dev/config/shared-options.html#resolve-alias),
[Vite plugin transforms](https://vite.dev/guide/api-plugin.html),
[`bun patch`](https://bun.sh/docs/pm/cli/patch)).

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
! rg 'vendor-tanstack-db' apps/radio/dist/server/index.js
bun run --filter @avoid.quest/radio cf-typegen
(cd apps/radio && bunx wrangler types --env-interface CloudflareEnv ./cloudflare-env.d.ts --check)
(cd apps/radio && bunx wrangler deploy --dry-run)
(cd apps/radio && bunx wrangler dev --local)
```

`wrangler deploy --dry-run` compiles the deployment without publishing it
([Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)).
The `rg` assertion checks that the built Worker entry does not eagerly import
the dedicated React DB chunk. `wrangler deploy --dry-run` does not boot the
Worker, so confirm that `wrangler dev --local` reaches `Ready` and serves a
request before stopping it.
Run a real deploy or version upload only when explicitly requested and when
Cloudflare credentials and the rate-limit namespace have been verified.
