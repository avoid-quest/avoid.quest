import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ALLOWED_BUNDLES = [
  "dattorro-reverb-bundle.js",
  "phase-vocoder-bundle.js",
] as const;

function getPossiblePaths(bundle: string): string[] {
  return [
    // Standard node_modules path
    resolve(
      process.cwd(),
      `node_modules/@avoid.quest/cacophony/dist/bundles/${bundle}`
    ),
    // Workspace path (for monorepo)
    resolve(process.cwd(), `../../packages/cacophony/dist/bundles/${bundle}`),
  ];
}

function findBundlePath(possiblePaths: string[]): string | null {
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function copyWorkletBundles() {
  const publicWorkletsDir = resolve(process.cwd(), "public/api/worklets");

  // Create directory if it doesn't exist
  if (!existsSync(publicWorkletsDir)) {
    mkdirSync(publicWorkletsDir, { recursive: true });
  }

  let copiedCount = 0;

  for (const bundle of ALLOWED_BUNDLES) {
    const possiblePaths = getPossiblePaths(bundle);
    const bundlePath = findBundlePath(possiblePaths);

    if (!bundlePath) {
      console.warn(
        `Warning: Bundle "${bundle}" not found. Tried paths:`,
        possiblePaths
      );
      continue;
    }

    const destPath = resolve(publicWorkletsDir, bundle);
    const content = readFileSync(bundlePath, "utf-8");
    writeFileSync(destPath, content, "utf-8");
    console.log(`Copied ${bundle} to ${destPath}`);
    copiedCount += 1;
  }

  if (copiedCount === 0) {
    console.error(
      "Error: No bundles were copied. Make sure @avoid.quest/cacophony is built."
    );
    process.exit(1);
  }

  console.log(
    `Successfully copied ${copiedCount} bundle(s) to public/api/worklets`
  );
}

copyWorkletBundles();
