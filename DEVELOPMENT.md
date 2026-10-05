# Development

## Apps

- **web** (`apps/web`): Astro landing page and links hub.
- **radio** (`apps/radio`): TanStack Start PWA internet radio player with multi-mode playback, platform resolvers, audio effects, MIDI support, and Cloudflare Worker deployment.
- **discord-bot** (`apps/discord-bot`): Discord bot for avoid.quest radio/platform interactions.

## Packages

- **config** (`packages/config`): Shared TypeScript configuration.
- **error** (`packages/error`): Shared error types, `AppError`, and Sentry helpers.
- **platforms** (`packages/platforms`): Platform scrapers and resolvers for Bandcamp, SoundCloud, YouTube, Mixcloud, Spotify metadata, and radio directories.
- **ui** (`packages/ui`): Shared React UI components, shadcn/ui primitives, and branding assets.

## Tech stack

- **Package manager and workspace scripts**: Bun
- **Bot runtime**: Node.js 24 (see [bot setup](apps/discord-bot/SETUP.md))
- **Monorepo**: Turborepo
- **Lint/format**: Ultracite/Biome
- **Web**: Astro, React islands, Tailwind CSS v4
- **Radio**: TanStack Start, TanStack Router, React 19, TypeScript, Web Audio API
- **Bot**: Discord.js, TypeScript, tsup
- **Deploy**: Cloudflare Workers for deployable web apps

## Development

```bash
bun install --frozen-lockfile # Install dependencies
bun run --filter @avoid.quest/radio dev # Start radio without credentials
bun run build        # Build all apps/packages
bun run typecheck    # Type check all packages
bun run check        # Lint/format check via Ultracite
bun run fix          # Auto-fix lint/format issues
```

Radio runs without credentials using `bun run --filter @avoid.quest/radio dev`.
Builds and tests also run without private credentials. The web and bot development
scripts use Doppler; for a credential-free marketing preview, build web then run
`bun run --filter @avoid.quest/web preview`.

For maintainer integrations, local development secrets are managed through Doppler. Install the Doppler CLI,
run `doppler login` once for your machine, then run `bun run secrets:setup` from
the repository root. The committed `doppler.yaml` preselects the
`avoid-quest` project and `dev_personal` config, matching Doppler's recommended
repo-root setup flow for monorepos.

For web or bot development, after Doppler setup:

```bash
bun run --filter @avoid.quest/web dev
bun run --filter @avoid.quest/discord-bot dev
```

`bun run dev` starts workspace dev tasks; web and radio both default to port
3000, so use the scoped commands above when working on one app.

Use `bun run secrets:status` to inspect which Doppler project/config is active
for the repository root. Doppler is the development secrets source of truth; do
not create or commit plaintext `.env`, `.dev.vars`, service tokens, or
downloaded secret files for normal local development.

## PR validation

[PR validation](.github/workflows/pr-validation.yml) runs on pull requests,
including stacked PRs targeting another feature branch. It uses the Bun version
in `package.json`, a frozen lockfile, and the existing root commands:
`bun run check`, `bun run typecheck`, `bun run test`, and `bun run build`.

Code/config changes validate every workspace. This deliberately small setup
covers shared UI/platform/error/config changes, the lockfile, and shared build
inputs without maintaining a second dependency graph. The web test already
builds its app; the build step also checks both frontend apps and the bot.
Markdown-only changes skip installation and app checks; reviewers still verify
documented paths/commands. `LICENSE`, `LICENSES/**`, `LICENSING.md`, and
`THIRD_PARTY_NOTICES.md` remain build inputs and receive full validation.

Platforms, Discord, and error run separate test TypeScript projects through
their own `typecheck` scripts; production compiler settings stay separate from
Bun test globals. Radio already includes its tests in its TypeScript project.

No private secrets or deployment commands are used. Radio already omits Sentry
sourcemap upload when any of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, or
`SENTRY_PROJECT` is missing. That affects upload only: lint, compiler, test, and
build errors still fail the job. No `continue-on-error` or upload error handler
suppresses failures.

### Existing builds and merge review

Read-only inspection on 2026-10-05 found GitHub Actions enabled and successful
`Workers Builds: avoid-quest` and `Workers Builds: radio` checks on PR #372.
Workers Builds remain responsible for existing previews. Their dashboard-owned
watch paths were not available in the repository or through the available
credentials, so they are not assumed to cover shared-package changes. The
repository workflow supplies that coverage without changing Workers settings.
Cloudflare documents [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)
separately from the checked-in Wrangler application configuration.

The branch-protection and ruleset APIs both returned HTTP 403 with
“Upgrade to GitHub Pro or make this repository public to enable this feature.”
Checks executing successfully do **not** establish a required-check merge gate.
Until enforcement is available and explicitly configured, a maintainer must
inspect the latest PR revision, require a successful `Validate` job and relevant
Workers Builds, and withhold merging on failure or missing checks. Account,
visibility, credentials, and protection settings are unchanged. See GitHub's
[protected-branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

To demonstrate failure reporting on a disposable revision of the validation PR,
add an incompatible fixture in `packages/error/src/validation-probe.test.ts`:

```ts
import type { AppErrorInit } from "./index";
export const invalidCategory: AppErrorInit["category"] = "invalid-category";
```

Push the revision, confirm `Validate` fails in the typecheck step, and save the
run URL. Inspect the merge panel without merging; record whether GitHub enforces
the failure separately from reporting it. Remove the fixture, push again, and
require the replacement run to pass before review. This is a one-time manual
verification, not a permanent failing test or a deployment.

## Cloudflare deployment

Deployable apps keep their Wrangler configuration under `apps/*/wrangler.jsonc`.
Do not deploy from automation unless the task explicitly asks for deployment.

Workers `workers.dev` exposure and preview URLs are enabled in committed
Wrangler config:

Non-production Workers Builds should publish preview URLs in PR comments.

| App | `workers_dev` | `preview_urls` | Production exposure |
|-----|---------------|----------------|---------------------|
| `@avoid.quest/web` | Enabled | Enabled | Use `workers.dev` plus Cloudflare account-level custom domains or routes as needed. |
| `@avoid.quest/radio` | Enabled | Enabled | Use `workers.dev` plus Cloudflare account-level custom domains or routes as needed. |

Custom production hostnames and any production-only overrides are intentionally
kept out of the public repository. Configure them in Cloudflare before
deploying.

```bash
bun run cf-build     # Build Cloudflare-targeted apps
bun run cf-deploy    # Deploy Cloudflare-targeted apps
bun run cf-upload    # Upload versions without promoting
bun run cf-typegen   # Regenerate Cloudflare environment type bindings
```

## UI components

```bash
bun run ui add <component-name>
```
