# Contributing

This is a source-available proprietary repository. Contributions are welcome by
pull request, but submitting a contribution means it may be incorporated into
avoid.quest under the repository license.

## Local Checks

Before opening a pull request, run the checks that match your change:

```bash
bun install
bun run check
bun run typecheck
```

For app or package changes, also run focused validation:

```bash
bun run --filter @avoid.quest/web build
bun run --filter @avoid.quest/radio test
bun run --filter @avoid.quest/radio build
```

For Cloudflare binding or environment type changes, run the relevant
`cf-typegen` script. Do not run deploy or upload commands unless a maintainer
explicitly asks for deployment.
