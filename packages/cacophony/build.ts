import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";
import pkg from "./package.json" with { type: "json" };

const URL_QUERY_REGEX = /\?url/;
const FILENAME_REGEX = /\/([^/]+)\.ts$/;
const ANY_PATH_REGEX = /.*/;
const BUNDLES_PATH_REGEX = /src[/\\]bundles[/\\](.+)$/;

// Plugin to handle ?url imports (Vite-style)
const urlImportPlugin: BunPlugin = {
  name: "url-import",
  setup(build) {
    // Intercept imports with ?url query parameter
    build.onResolve({ filter: URL_QUERY_REGEX }, ({ path, importer }) => {
      const filePath = path.replace(URL_QUERY_REGEX, "");
      // Resolve relative to importer (the file importing it)
      const importerDir = importer ? resolve(importer, "..") : process.cwd();
      const resolvedPath = resolve(importerDir, filePath);

      // Return the resolved path with our custom namespace
      return {
        path: resolvedPath,
        namespace: "url-import",
      };
    });

    // Provide the URL string export for ?url imports
    build.onLoad(
      { filter: ANY_PATH_REGEX, namespace: "url-import" },
      ({ path }) => {
        // Check if this is a bundle file in src/bundles
        const bundlesMatch = path.match(BUNDLES_PATH_REGEX);
        if (bundlesMatch) {
          const bundleFileName = bundlesMatch[1];
          // Return path relative to dist directory (where bundles will be copied)
          return {
            contents: `export default ${JSON.stringify(`./bundles/${bundleFileName}`)};`,
            loader: "js",
          };
        }

        // For other files, return a relative path
        const relativePath = path.replace(`${process.cwd()}/`, "./");
        return {
          contents: `export default ${JSON.stringify(relativePath)};`,
          loader: "js",
        };
      }
    );
  },
};

const buildWorkletsOnly = process.argv.includes("--worklets");
const buildLibOnly = process.argv.includes("--lib");

async function buildMainLibrary() {
  console.log("Building main library...");

  const externalDeps = Object.keys(pkg.dependencies);
  const buildConfig = {
    entrypoints: ["./src/index.ts"],
    outdir: "./dist",
    target: "browser" as const,
    sourcemap: "external" as const,
    external: externalDeps,
    plugins: [urlImportPlugin],
  };

  // Build ESM and CJS bundles
  const [esmResult, cjsResult] = await Promise.all([
    Bun.build({
      ...buildConfig,
      format: "esm",
      naming: { entry: "index.mjs" },
    }),
    Bun.build({
      ...buildConfig,
      format: "cjs",
      naming: { entry: "index.cjs" },
    }),
  ]);

  if (!esmResult.success) {
    console.error("ESM build failed:");
    for (const log of esmResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  if (!cjsResult.success) {
    console.error("CJS build failed:");
    for (const log of cjsResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Copy worklet bundles to dist
  const srcBundlesDir = "./src/bundles";
  const distBundlesDir = "./dist/bundles";
  try {
    const bundles = await readdir(srcBundlesDir);
    const bundleFiles = bundles.filter((f) => f.endsWith("-bundle.js"));

    await Promise.all(
      bundleFiles.map(async (file) => {
        const content = await Bun.file(join(srcBundlesDir, file)).text();
        await Bun.write(join(distBundlesDir, file), content);
      })
    );
    console.log(`Copied ${bundleFiles.length} bundle(s) to dist/bundles`);
  } catch (err) {
    console.warn("Warning: Could not copy bundles:", err);
  }

  // Generate TypeScript definitions
  const tscExitCode = await Bun.spawn({
    cmd: [
      "bunx",
      "tsc",
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      "./dist",
      "--project",
      "./tsconfig.json",
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).exited;

  if (tscExitCode !== 0) {
    console.error("TypeScript definition generation failed");
    process.exit(1);
  }

  console.log("Main library build complete!");
}

async function buildWorkletBundles() {
  console.log("Building worklet bundles...");

  const processorsDir = "src/processors";
  const files = await readdir(processorsDir);
  const processorFiles = files
    .filter(
      (f) =>
        f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")
    )
    .map((f) => join(processorsDir, f));

  if (processorFiles.length === 0) {
    console.warn("No processor files found");
    return;
  }

  // Build all processors in parallel
  const results = await Promise.all(
    processorFiles.map((inputFile) => {
      const match = inputFile.match(FILENAME_REGEX);
      const fileName = match?.[1];
      if (!fileName) {
        throw new Error(`Could not extract filename from ${inputFile}`);
      }

      console.log(`Building ${fileName}...`);
      return Bun.build({
        entrypoints: [inputFile],
        outdir: "./src/bundles",
        format: "iife",
        target: "browser",
        minify: { whitespace: true, identifiers: false, syntax: true },
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        naming: { entry: `${fileName}-bundle.js` },
      });
    })
  );

  // Check for failures
  const failed = results.find((r) => !r.success);
  if (failed) {
    console.error("Build failed:");
    for (const log of failed.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log("Worklet bundles build complete!");
}

async function main() {
  if (buildWorkletsOnly) {
    await buildWorkletBundles();
  } else if (buildLibOnly) {
    await buildMainLibrary();
  } else {
    // Build both if no flag specified
    // Worklets must be built first since the main library imports them
    await buildWorkletBundles();
    await buildMainLibrary();
  }
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
