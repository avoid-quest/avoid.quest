# Third-party notices and corresponding source

The root MIT license covers original avoid.quest material only. Installed
package license files are collected into `/legal/dependencies.txt` on each site
build, including transitive dependencies, with exact names and versions. These
notices deliberately include some dependencies not used by the final bundle.
The complete license texts in `LICENSES/` are served alongside them.

## openDAW — AGPL-3.0-or-later

Copyright André Michelle and openDAW contributors. The locked packages and their
actual `LICENSE` files were checked against `bun.lock`:

| Package (`@opendaw/`) | Version |
| --- | --- |
| lib-box | 0.0.95 |
| lib-dawproject | 0.0.79 |
| lib-dom | 0.0.91 |
| lib-dsp | 0.0.94 |
| lib-fusion | 0.0.104 |
| lib-midi | 0.0.75 |
| lib-runtime | 0.0.87 |
| lib-std | 0.0.86 |
| lib-xml | 0.0.72 |
| studio-adapters | 0.3.5 |
| studio-boxes | 0.0.111 |
| studio-core | 0.2.7 |
| studio-core-wasm | 0.0.18 |
| studio-enums | 0.1.4 |

All these installed manifests identify source revision
[`88113f892cea2fa9495289a9c166b6fe0f93ce69`](https://github.com/andremichelle/openDAW/tree/88113f892cea2fa9495289a9c166b6fe0f93ce69).
[Download that source](https://github.com/andremichelle/openDAW/archive/88113f892cea2fa9495289a9c166b6fe0f93ce69.tar.gz).
This includes the TypeScript packages, Rust engine/device crates, interface
sources and build scripts, not just compiled npm output. Older repo notes
calling these packages LGPL were incorrect for these locked releases.

Radio's `apps/radio/opendaw-assets.ts` changes EngineWorklet's NAM WASM URL to a
same-origin asset. `vite.config.ts` applies that patch, strips obsolete source-map
URLs from copied JS and ships processors, engine WASM and device WASM plugins.
The upstream engine/device binaries themselves are not modified.

These files under `apps/radio/src/lib/audio/dsp/` contain openDAW adaptations and
retain AGPL-3.0-or-later terms: `effects/ctag-compressor.ts`,
`effects/fold.ts`, `effects/limiter.ts`, `effects/revamp.ts`,
`effects/stereo-tool.ts`, `effects/tidal.ts`, and `effects/werkstatt-presets.ts`.
The DSP adaptations connect upstream algorithms to radio's effect interface.
The six copied Werkstatt examples come from
[`a85f975d766647670ef37e4fcbe0f75901642e72`](https://github.com/andremichelle/openDAW/tree/a85f975d766647670ef37e4fcbe0f75901642e72),
as recorded in `apps/radio/OPENDAW_WERKSTATT_RESEARCH.md`; Alienator and Beautifier
retain Chaosmeister's authorship comments. Local wrappers and changes are in the
radio source archive and git history. No proprietary openDAW license is assumed.

### Build the shipped application

Use Bun 1.4.2 (as pinned in `package.json`) and a current Node installation.
Extract radio's `/legal/source.tar.gz`, then from its root:

```sh
bun install --frozen-lockfile
bun run --filter @avoid.quest/radio build
```

A source archive has no `.git`; set `SOURCE_REVISION` to the revision shown on
`/legal/` when rebuilding it. The legal preparation script packages that source
without requiring git history. Private Doppler, Sentry and GitHub tokens are
optional integrations, not prerequisites. See [radio setup](apps/radio/README.md)
and [contributor setup](DEVELOPMENT.md). The build uses the exact npm artifacts
and integrity hashes in `bun.lock` and applies the worklet patch automatically.

### Rebuild upstream WASM and JS

In the openDAW source revision above, use Node >=23, npm 11.4.2, Rust stable,
Rust nightly with `rust-src`, and the `wasm32-unknown-unknown` target. Binaryen's
`wasm-opt` is optional (it reduces binary size). Run:

```sh
npm ci
rustup target add wasm32-unknown-unknown
rustup toolchain install nightly --component rust-src
npm run build
```

The source's `packages/studio/core-wasm/build-wasm.sh` documents its link flags
and builds `engine.wasm`, `stretch_wasm.wasm`, and device plugins. The root
`npm run build-wasm` invokes that script alone. TypeScript package builds and
processor bundling are defined in their workspace manifests. To use modified
artifacts in radio, replace the corresponding installed packages with your local
build outputs before running radio's build. We verified these scripts and source
paths; an independent Rust toolchain rebuild is not claimed.

## Embedded DSP and other code

- `@opendaw/nam-wasm` **1.2.0** is MIT, Copyright (c) 2023 Steven Atkinson.
  Its npm LICENSE is included in generated notices; its WASM is served at
  `/opendaw/nam.wasm` and `/assets/@opendaw/nam-wasm/nam.wasm`.
  [Source and Emscripten build instructions](https://github.com/andremichelle/nam-wasm).
- openDAW's Signalsmith Stretch implementation retains the MIT notice,
  Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd., in
  [LICENSES/signalsmith-stretch-MIT.txt](LICENSES/signalsmith-stretch-MIT.txt).
  The corresponding implementation is in the pinned openDAW `crates/signalsmith`
  and `crates/stretch` sources.
- CTAGDRC compressor algorithms originate with Patrick H. Lechner / CTAGDRC.
  [Upstream source](https://github.com/p-hlp/CTAGDRC) is GPL-3.0;
  [its license](LICENSES/CTAGDRC.txt) is preserved. openDAW's TypeScript and Rust
  adaptations are in the pinned source above; the combined radio work is AGPL.
- Shared UI primitives derived from shadcn/ui retain its
  [MIT notice](LICENSES/shadcn-ui.txt). Lucide icons and other npm dependencies
  retain their own notices in the generated dependency file.

The registry crates in the pinned openDAW `crates/Cargo.lock` have their full
license/copyright texts and versioned source archive URLs preserved in
[LICENSES/opendaw-rust-dependencies.txt](LICENSES/opendaw-rust-dependencies.txt).
All 46 archive checksums were verified against that lockfile. The list includes
build/test dependencies as well as WASM runtime dependencies; missing dasp crate
license files were recovered from the exact source revisions recorded in their
`.cargo_vcs_info.json`. The MIT option is used for those dual-licensed crates.
The FFmpeg JavaScript wrapper packages' omitted license files are supplied from
[their upstream MIT license](LICENSES/ffmpeg-wasm.txt); radio does not ship a
separate FFmpeg core WASM binary.

The GitHub mark is from [GitHub Octicons](https://github.com/primer/octicons),
Copyright (c) 2026 GitHub Inc.; its [MIT license](LICENSES/octicons-MIT.txt) is
preserved. The mark identifies the repository link; it does not imply endorsement.

## Fonts and assets

Marketing bundles `@fontsource/geist-sans` and `@fontsource/geist-mono` **5.3.0**,
under **SIL OFL-1.1**. Their complete copyright and license files are copied into
its generated dependency notices. Font authors include Vercel, basement.studio
and the Geist Project Authors, as specified in those files.

Original avoid.quest logos, favicons and application screenshots are under MIT.
Third-party artwork or trademarks visible in screenshots remain their owners'
material. Stream URLs, historical public-account datasets and external platform
metadata do not imply endorsement or a license to third-party media.
