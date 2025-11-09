import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

type RouteParams = {
  params: Promise<{ bundle: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { bundle } = await params;

    // Only allow specific bundle files for security
    const allowedBundles = ["dattorro-reverb-bundle.js"];
    if (!allowedBundles.includes(bundle)) {
      console.error(`Bundle not allowed: ${bundle}`);
      return new NextResponse("Bundle not found", { status: 404 });
    }

    // Try multiple possible paths for the bundle file
    const possiblePaths: string[] = [
      // Standard node_modules path
      resolve(process.cwd(), `node_modules/@avoid.quest/cacophony/dist/bundles/${bundle}`),
      // Workspace path (for monorepo)
      resolve(process.cwd(), `../../packages/cacophony/dist/bundles/${bundle}`),
    ];

    // Handle Bun's specific node_modules structure
    try {
      const bunModulesPath = resolve(process.cwd(), "node_modules/.bun");
      if (existsSync(bunModulesPath)) {
        const bunDirs = readdirSync(bunModulesPath, { withFileTypes: true });
        for (const dir of bunDirs) {
          if (dir.isDirectory() && dir.name.startsWith("@avoid.quest+cacophony@")) {
            const bunPath = resolve(
              bunModulesPath,
              dir.name,
              "node_modules/@avoid.quest/cacophony/dist/bundles",
              bundle
            );
            possiblePaths.push(bunPath);
          }
        }
      }
    } catch {
      // Ignore errors when checking Bun paths
    }

    let bundlePath: string | null = null;
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        bundlePath = path;
        break;
      }
    }

    if (!bundlePath) {
      console.error("Bundle file not found. Tried paths:", possiblePaths);
      return new NextResponse("Bundle not found", { status: 404 });
    }

    // Read the file content
    const bundleContent = readFileSync(bundlePath, "utf-8");

    // Get file modification time for cache validation
    const stats = statSync(bundlePath);
    const lastModified = stats.mtime.toUTCString();
    const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

    // Return the file with appropriate headers for AudioWorklet
    // In development, use shorter cache to allow updates
    // In production, use longer cache with ETag for validation
    const isDevelopment = process.env.NODE_ENV === "development";
    return new NextResponse(bundleContent, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": isDevelopment
          ? "no-cache, must-revalidate"
          : "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        "Last-Modified": lastModified,
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("Failed to load worklet bundle:", error);
    return new NextResponse(
      `Error loading bundle: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 }
    );
  }
}

