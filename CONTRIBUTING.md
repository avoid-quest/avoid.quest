# Contributing

Found a problem or have an idea? [Open an issue](https://github.com/avoid-quest/avoid.quest/issues/new/choose),
or use Feedback in radio. Reports are public: leave out contact details, secrets,
and private listening links. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

For code changes, describe the problem and send a focused pull request. See
[development setup](DEVELOPMENT.md) and the [radio guide](apps/radio/README.md).
Run from the repository root:

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
```

Also run each changed workspace's build and tests, for example:

```sh
bun run --filter @avoid.quest/web test
bun run --filter @avoid.quest/radio test
bun run --filter @avoid.quest/radio build
```

Run the relevant `cf-typegen` script for Cloudflare binding changes. Do not
manually deploy or upload unless a maintainer requests it. The repository-owned
[PR validation workflow](.github/workflows/pr-validation.yml) runs lint,
typechecks, tests, and builds without private credentials. Cloudflare Workers
Builds continue to provide their existing build checks and previews. See
[validation and merge review](DEVELOPMENT.md#pr-validation) for coverage and
the remaining manual merge gate.

Original contributions you have the right to license are submitted under MIT.
Changes to third-party derived files retain their applicable licenses; the
combined radio application is distributed under AGPL-3.0-or-later. See
[licensing scope](LICENSING.md). Keep copyright and license notices, identify
third-party sources, and do not submit material you lack permission to contribute.
No copyright assignment is required.

Radio release notes come from git history. Use short listener-facing `feat`
subjects; put `Changelog: <listener-facing text>` in the commit body to describe
a fix, or `Changelog: skip` for internal features. In squash PRs these lines must
appear in the merge body above the list of squashed commits.
