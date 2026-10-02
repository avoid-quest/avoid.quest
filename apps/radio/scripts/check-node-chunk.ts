/**
 * Node chunk check, run after `vite build`.
 *
 * React Flow is browser-only and about 60 kB gzip, so Node mode keeps it in a
 * lazy client chunk. This fails the build when:
 *
 * - any `@xyflow` code reaches the Worker/SSR bundle (dist/server);
 * - no client chunk holds React Flow;
 * - a React Flow chunk is loaded eagerly: reachable through static imports
 *   from the route entries and preloads in the TanStack Start manifest;
 * - no client chunk imports it lazily.
 *
 * It also fails when a vendor used only by lazy features (see
 * LAZY_VENDORS) loads eagerly with the page.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const SERVER_DIR = path.join(DIST, "server");
const CLIENT_ASSETS = path.join(DIST, "client", "assets");

/** Strings only React Flow's runtime carries. */
const XYFLOW_MARKERS = ["react-flow__renderer", "@xyflow/"];
/** Strings only these vendors carry; each must stay out of eager chunks. */
const LAZY_VENDORS = [
  // Node mode's resizable shell.
  { markers: ['"data-separator"'], name: "react-resizable-panels" },
  // Node mode's branch edges and the What's new popover.
  { markers: ["PopoverTrigger"], name: "Radix Popover" },
];
const STATIC_IMPORT =
  /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']\.\/([^"']+\.js)["']/g;
const DYNAMIC_IMPORT = /import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g;
const MAPPED_DEP = /["'](?:\/assets\/|assets\/)?([\w.-]+\.js)["']/g;
const MANIFEST_ASSET = /\/assets\/([\w.-]+\.js)/g;
const SCRIPT_FILE = /\.m?js$/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function isScript(file: string): boolean {
  return SCRIPT_FILE.test(file);
}

function hasXyflow(source: string): boolean {
  return XYFLOW_MARKERS.some((marker) => source.includes(marker));
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

const failures: string[] = [];

const serverHits = listFiles(SERVER_DIR)
  .filter(isScript)
  .filter((file) => hasXyflow(readFileSync(file, "utf8")));
for (const file of serverHits) {
  failures.push(
    `React Flow reached the Worker bundle: ${path.relative(DIST, file)}`
  );
}

const chunks = new Map(
  readdirSync(CLIENT_ASSETS)
    .filter((name) => name.endsWith(".js"))
    .map((name) => [name, readFileSync(path.join(CLIENT_ASSETS, name), "utf8")])
);
const flowChunks = [...chunks].filter(([, source]) => hasXyflow(source));
if (flowChunks.length === 0) {
  failures.push("No client chunk holds React Flow");
}

const manifest = listFiles(SERVER_DIR).find((file) =>
  path.basename(file).startsWith("_tanstack-start-manifest")
);
if (manifest) {
  // Everything the manifest names loads with the page; follow static imports.
  const eager = new Set<string>();
  const queue = matches(readFileSync(manifest, "utf8"), MANIFEST_ASSET);
  while (queue.length > 0) {
    const name = queue.pop() ?? "";
    if (eager.has(name) || !chunks.has(name)) {
      continue;
    }
    eager.add(name);
    queue.push(...matches(chunks.get(name) ?? "", STATIC_IMPORT));
  }
  for (const [name] of flowChunks) {
    if (eager.has(name)) {
      failures.push(`React Flow chunk ${name} loads eagerly with the page`);
    }
  }
  for (const vendor of LAZY_VENDORS) {
    for (const name of eager) {
      const source = chunks.get(name) ?? "";
      if (vendor.markers.some((marker) => source.includes(marker))) {
        failures.push(`${vendor.name} in ${name} loads eagerly with the page`);
      }
    }
  }
} else {
  failures.push("TanStack Start manifest not found in dist/server");
}

// Vite loads a lazy chunk's own imports through a dependency map next to the
// dynamic import, so a lazy chunk shows up in either form.
const lazyTargets = new Set(
  [...chunks.values()].flatMap((source) => [
    ...matches(source, DYNAMIC_IMPORT),
    ...(source.includes("__vite__mapDeps") || source.includes("import(")
      ? matches(source, MAPPED_DEP)
      : []),
  ])
);
for (const [name, source] of flowChunks) {
  const importers = [...chunks].filter(([, other]) =>
    matches(other, STATIC_IMPORT).includes(name)
  );
  const loadedLazily =
    lazyTargets.has(name) ||
    importers.some(([importer]) => lazyTargets.has(importer));
  if (!(loadedLazily && source.length > 0)) {
    failures.push(`React Flow chunk ${name} is not loaded lazily`);
  }
}

// The canvas is Node mode's only door to React Flow: the chunk that lazily
// loads it also draws the Stage, Rack and inspector, which a phone opens
// first, so it must not reach React Flow through static imports.
const canvasChunks = [...chunks.keys()].filter((name) =>
  name.startsWith("node-canvas-")
);
if (canvasChunks.length === 0) {
  failures.push("No node-canvas client chunk found");
}
const flowNames = new Set(flowChunks.map(([name]) => name));
for (const [importer, source] of chunks) {
  const dynamic = matches(source, DYNAMIC_IMPORT);
  if (!canvasChunks.some((name) => dynamic.includes(name))) {
    continue;
  }
  const reached = new Set<string>();
  const queue = matches(source, STATIC_IMPORT);
  while (queue.length > 0) {
    const name = queue.pop() ?? "";
    if (reached.has(name) || !chunks.has(name)) {
      continue;
    }
    reached.add(name);
    queue.push(...matches(chunks.get(name) ?? "", STATIC_IMPORT));
  }
  for (const name of reached) {
    if (flowNames.has(name)) {
      failures.push(
        `${importer} loads the canvas lazily but imports React Flow chunk ${name} statically`
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`[check-node-chunk] ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `[check-node-chunk] React Flow is only in lazy client chunks: ${flowChunks
    .map(([name]) => name)
    .join(", ")}`
);
