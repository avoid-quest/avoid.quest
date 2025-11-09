import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

type RouteParams = {
  params: Promise<{ bundle: string }>;
};

const ALLOWED_BUNDLES = ["dattorro-reverb-bundle.js"] as const;

function isBundleAllowed(bundle: string): boolean {
  return ALLOWED_BUNDLES.includes(bundle as (typeof ALLOWED_BUNDLES)[number]);
}

function getBunPaths(bundle: string): string[] {
  const bunPaths: string[] = [];
  try {
    const bunModulesPath = resolve(process.cwd(), "node_modules/.bun");
    if (!existsSync(bunModulesPath)) {
      return bunPaths;
    }
    const bunDirs = readdirSync(bunModulesPath, { withFileTypes: true });
    for (const dir of bunDirs) {
      if (dir.isDirectory() && dir.name.startsWith("@avoid.quest+cacophony@")) {
        const bunPath = resolve(
          bunModulesPath,
          dir.name,
          "node_modules/@avoid.quest/cacophony/dist/bundles",
          bundle
        );
        bunPaths.push(bunPath);
      }
    }
  } catch {
    // Ignore errors when checking Bun paths
  }
  return bunPaths;
}

function getPossiblePaths(bundle: string): string[] {
  const basePaths: string[] = [
    // Standard node_modules path
    resolve(
      process.cwd(),
      `node_modules/@avoid.quest/cacophony/dist/bundles/${bundle}`
    ),
    // Workspace path (for monorepo)
    resolve(process.cwd(), `../../packages/cacophony/dist/bundles/${bundle}`),
  ];
  return [...basePaths, ...getBunPaths(bundle)];
}

function findBundlePath(possiblePaths: string[]): string | null {
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function createResponseHeaders(bundlePath: string): Record<string, string> {
  const stats = statSync(bundlePath);
  const lastModified = stats.mtime.toUTCString();
  const etag = `"${stats.mtime.getTime()}-${stats.size}"`;
  const isDevelopment = process.env.NODE_ENV === "development";

  return {
    "Content-Type": "application/javascript",
    "Cache-Control": isDevelopment
      ? "no-cache, must-revalidate"
      : "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Last-Modified": lastModified,
    ETag: etag,
  };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { bundle } = await params;

    if (!isBundleAllowed(bundle)) {
      console.error(`Bundle not allowed: ${bundle}`);
      return new NextResponse("Bundle not found", { status: 404 });
    }

    const possiblePaths = getPossiblePaths(bundle);
    const bundlePath = findBundlePath(possiblePaths);

    if (!bundlePath) {
      console.error("Bundle file not found. Tried paths:", possiblePaths);
      return new NextResponse("Bundle not found", { status: 404 });
    }

    const bundleContent = readFileSync(bundlePath, "utf-8");
    const headers = createResponseHeaders(bundlePath);

    return new NextResponse(bundleContent, { headers });
  } catch (error) {
    console.error("Failed to load worklet bundle:", error);
    return new NextResponse(
      `Error loading bundle: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 }
    );
  }
}
